+++
title = "Creating GIFs directly from Gameplay"
date = 2026-06-09
tags = ["godot", "dev-tools", "rendering"]
author = "jack"
description = "How we created a lightweight method to continuously record the game viewport to directly generate GIFs from gameplay"
draft = false
+++

Carps and I first met by playing each other's Mario Maker 2 levels. Back then, we would create a new level and using the Switch's inbuilt video capture, record ourselves finishing our own levels. We could then show work in progress by sharing a few clips.

The whole workflow was really easy, the switch would remember the last 30 seconds of gameplay, and so as long as each section broke down easily enough, you could stich the three sections of a usual level in three 30 second chunks. [Here's an example](https://www.reddit.com/r/MarioMaker/s/ZeL2yvLMFb), hosted on Reddit.

I really like this retroactive way of capturing gameplay. Sometimes when you play, something exciting happens and being able to extract the past, rather than preemptively asking the game to record before the cool thing, allows you to catch times which are surprising. This is especially true when you're making a game and sometimes a hard to replicate bug can appear. Being able to request the previous few seconds of gameplay is ideal for bug evidence.

Now, on the Switch, I imagine Nintendo have done some very clever tricks at the hardware level to parallelise the storage of the clip frames without introducing any lag into the gameplay. This blog post is our attempt to get a similar level of functionality within Godot.

## The Plan

Before we talk about the Godot internals, let's sketch out roughly what we want to do. To create a video, or GIF, of the past we need a way to continuously store what is happening on the screen at any given point. For encoding reasons, we chose to record GIFs at 25 FPS, but technically this can be totally custom.

{{< comment text="A GIF is a series of images separated by some delay. The delay is encoded in 100ths of seconds, so it's good to pick a FPS which evenly divides 100." >}}

What this ultimately means is that if we want to remember the last `n` seconds of gameplay, we'll need to store `25*n` frames in memory and continuously remove the oldest frames when adding the latest frame. We need the capturing and saving of this data to be fast enough that we can reasonably perform every 40ms while the main game is running.

Then, we need to handle how this is saved. We expect the player to press a button to prompt the save. At this point, all of the viewport frame data needs to be processed to turn into a video. This ultimately means encoding every frame in some image format which is then compressed into some video format (such as mp4) or a GIF.

Lastly we'll need to hook in some UI which tells the player when they have started clipping, when it finishes and whether the clip succeeded or failed to be saved.

Capturing frame data and creating a GIF are essentially two completely independent pieces of work, but they need to be aware of each other. In particular, we expect the creation of the GIF to be computationally heavy and so we want to ensure that the computer attempts to do as much of this work on an independent thread to the one the game is running on. This is important to remember and will limit how efficiently we can store the frame data itself.

{{< comment text="Another option not explored in this post at all would be to capture game input and then play back all these inputs when the user asks to save the clip. This would have to pause gameplay but probably not introduce any lag during the gameplay before the clip." >}}

## Continuously Capturing Viewport Textures

### Ring Buffers

Before tackling how we obtain each frame, let's discuss how we can manage the memory of the frame data itself. Our solution uses something called a ring buffer. The idea is that we store both an `Array` together with an `int` type which indexes the ring buffer. Adding a frame to the array means storing the value at the current index, then incrementing the index modulo the fixed size.

A sketch of this in code would look like this:

```gdscript
# These constants can be freely chosen to balance performance
const CAPTURE_FPS: int = 25
const BUFFER_SECONDS: int = 5
const BUFFER_SIZE: int = CAPTURE_FPS * BUFFER_SECONDS

var buffer_index: int = 0
var ring_buffer: Array[Image] = []

func _ready() -> void:
    # Preallocate the space to the ring buffer
	ring_buffer.resize(BUFFER_SIZE)

func _save_to_buffer(img: Image) -> void:
    ring_buffer[buffer_index] = img
    buffer_index = (buffer_index + 1) % BUFFER_SIZE
```

What this means is that the buffer never needs to have its size modified and streamlines how we can save and overwrite the oldest of frames without needing to explicitly remove anything.

Reading the frames in order is then as easy as:

```gdscript
for i in BUFFER_SIZE:
	var frame: Image = ring_buffer[(buffer_index + i) % BUFFER_SIZE]
```


### Saving the Texture Image

With an efficient memory structure to hold the frame data, we now need to make a decision about exactly what data we're saving for each frame.

This point is where memory considerations need to be made. Our pixel art game runs in a `480x270` viewport, but is then upscaled to a much higher resolution to allow for HD elements. There is a 16x memory cost in storing the `1920x1080` viewport texture compared to the low-res `480x270`. As a result, we decided to capture a `SubViewport` which contained only the low-res gameplay elements which means all UI and other HD elements introduced into the game are invisible to our screen capture.

As explained in [Perfecting 36 Year Old Rendering in a Modern Engine](/posts/pixel_perfect), we actually have two low resolution sub viewports within the game to have particles behave as we want. As a result we can't simply call a texture directly from where the game is drawn. Instead, we make a new `SubViewportContainer` with the following structure:

```asm
RecordingSubViewportContainer (SubViewportContainer)
├── RecordingSubViewport (SubViewport)
│   └── GameTextureRect (TextureRect) [ViewportTexture set to the game]
│   └── ParticleTextureRect (TextureRect) [ViewportTexture set to the particles]
```

Then, the texture we want to capture is the texture of `RecordingSubViewport` which will be a "small" `480x270` texture about 500kb in size. We can register this viewport as the target with

```gdscript
func register_viewport(viewport: SubViewport) -> void:
	assert(viewport.size == Vector2i(480, 270))
	target_viewport = viewport
```

by calling `ScreenRecorder.register_viewport(self)` within the script of `RecordingSubViewport`. Now, most of the time this viewport is useless, so we set the viewport rendering mode to `DISABLED` and then set it to `UPDATE_ONCE` only on the frame we want to capture.

With `target_viewport` now capturing what we want, the easiest solution is to then save to the buffer the image directly: `target_viewport.get_image()`, however this introduces latency into the game as the CPU waits for the texture from the GPU which might not be ready to send this data. Later in the blog we talk about some other ideas, but this is actually what is being used currently and we find the FPS of the game drops from about 120+ to 80-110 FPS while the recording is active. 


### Triggering Frame Capture

With a ring buffer in place and a way to save each individual frame, we now need to hook up various signals to ensure that we are consistently saving frame data to allow the resulting clip to run at the chosen FPS. At 25 FPS, we need to trigger capture every 1/25 seconds or equivalently every 40 ms.

The rough set up is as follows. We store a constant `TICK_LENGTH` equal to the tick length. We then set a timer variable `tick_time` at `_ready()` equal to this value. Within the `_process(delta: float)` method, we decrease `tick_time` and if this value is non-positive, we trigger the code to capture a frame and add `TICK_LENGTH` back to `tick_time`.

However, we need to be careful that we only capture the frame after the GPU has finished drawing. To abstract this, we instead simply update `waiting_for_frame: bool` to be `true` within the process loop. Then by connecting `RenderingServer.frame_post_draw.connect(_on_frame_post_draw)` we can only ever attempt to save data when Godot knows everything is ready to be saved.

The work flow of this section then looks roughly like:

```gdscript
const CAPTURE_FPS: int = 25
const TICK_LENGTH: float = 1.0 / CAPTURE_FPS

func _ready() -> void:
	# Connect the signal which saves images to the buffer
	RenderingServer.frame_post_draw.connect(_on_frame_post_draw)

	# Set the tick timer
	tick_time = TICK_LENGTH

func _process(delta: float) -> void:
	# Decrease the timer and capture when expired
	tick_time -= delta
	if tick_time <= 0:
		tick_time += TICK_LENGTH
		waiting_for_frame = true

func _on_frame_post_draw() -> void:
	"""
	Saves the current viewport texture to the buffer
	"""
	if not waiting_for_frame:
		return

	if target_viewport == null:
		waiting_for_frame = false
		return

	var img = target_viewport.get_texture().get_image()
	ring_buffer[buffer_index] = img
	buffer_index = (buffer_index + 1) % BUFFER_SIZE
	waiting_for_frame = false
```


## A GIF of the Past

### A GDScript Native Solution?

{{< todo text="write how this was slow and not thread safe">}}

### Creating GIFs with FFMPEG

{{< pixel_art src="gif/gif_making/bg_ffmpeg.gif" scale="two" alt="A  GIF made using FFMPEG where the generated palette breaks intended art style" caption="Due to the large variance in background colours, the important colours, such as the one on our main character, are corrupted" >}}

Now one option was to try and remove a bunch of the effects to keep the total palette of the level down to 256 colors. In this case, it seemed to work:

{{< pixel_art src="gif/gif_making/nbg_ffmpeg.gif" scale="two" alt="A GIF made using FFMPEG where the generated palette works due to less background effects" caption="With less variation in the background, there's space in the palette for the character's colours to remain true" >}}

But this had an important issue. We can manually toggle effects for crisper GIFs without a problem, but as the game grows in complexity we expect more shaders and other changes to start changing the total colour count. There were a few different ideas I cycled though:

1. Can I force the player colours into the palette wy feeding in the player image into the palette generation? This in fact did work, but then I realised the blue mushroom was also corrupt. I could add this blue in, but then when do I stop? There will be many unique elements in levels with small distinct colours and I can't account for them all without running out of colours generally!
2. Can I just use a different set of arguments to `ffmpeg` to get a colour palette which selects for lots of different hues instead of from the most common? I think maybe you can, but I couldn't figure it out from the documentation.
3. Are all libraries going to behave the same? Maybe I can try something other than `ffmpeg`?

### Creating GIFs with Image Magick

### More Comparisons between FFMPEG and Image Magick

If you've got this far I'm now assuming you're a bit of a GIF nerd and are interested in seeing some more examples. I found that cropping the images from the full resolution to a partial viewport also improved things (because obviously there's less colours again).

#### FFMPEG

{{< 
	pixel_slider 
    src1="/gif/gif_making/bg_ffmpeg.gif" 
	src2="gif/gif_making/bg_imagemagick.gif" 
	alt1="A cropped gif made using FFMPEG with background effects"
	alt2="A cropped gif made using FFMPEG without background effects" caption="A direct comparison between FFMPEG and Image Magick generated GIFs when background effects are on" 
	scale="two" 
	label1="Image Magick"
	label2="ffmpeg"
>}}


## Future Improvements

I'm still not totally happy with the solution, in particular, I feel as though there must be an async way to obtain the texture data from the GPU without stalling the CPU during the frame capture. I would love to add to the buffer the texture `RID` or some other lighter data structure which I could then create an image from using the worker thread instead of the main game thread.

This is something I am unexperienced with and potentially the solution is "easy" when you know what you're doing.

The problem seems to be in how we could offload the request from the GPU into memory from a worker thread instead of a main thread. As far as I can tell from the documentation, `RenderingSever` can directly request texture data from the `RID` of the texture, but that this work has to be done on the main thread?

Alternatively, there is the `RenderingDevice` but this requires building the game in Forward+ rather than Compatibility mode and I'm not sure we want to go down this route. The `RenderingDevice` does include an async call to the `texture_get_data_async(texture: RID, layer: int, callback: Callable)`, but this hasn't been properly explored yet.


