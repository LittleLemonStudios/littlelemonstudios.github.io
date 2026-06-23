+++
title = "Creating Clips directly from Gameplay"
date = 2026-06-09
tags = ["godot", "dev-tools", "rendering"]
author = "jack"
description = "How we created a lightweight method to continuously record the game viewport to directly generate video and GIF files from gameplay"
draft = false
+++

{{< 
  pixel_video 
  src="/mp4/gif_making/nbg.mp4" 
  w="480"
  h="270"
  scale="two"
>}}

Carps and I first met by playing each other's Mario Maker 2 levels. Back then, we would create a new level and using the Switch's inbuilt video capture, record ourselves finishing our own levels. We could then show work in progress by sharing a few clips.

The whole workflow was really easy, the switch would remember the last 30 seconds of gameplay, and so as long as each section broke down easily enough, you could stich the three sections of a usual level in three 30 second chunks. [Here's an example](https://www.reddit.com/r/MarioMaker/s/ZeL2yvLMFb), hosted on Reddit.

I really like this retroactive way of capturing gameplay. Sometimes when you play something unexpected can happen. Being able to extract the past, rather than preemptively asking the game to record before the cool thing happens, allows you to capture the moments you'd otherwise miss. This is especially true when you're making a game and you want to save evidence of some hard to replicate bug.

Now, on the Switch, I imagine Nintendo have done some very clever tricks at the hardware level to parallelise the storage of the clip frames without introducing any lag into the gameplay. This blog post is our attempt to get a similar level of functionality within Godot.

## The Plan

Before we talk about the Godot internals, let's sketch out roughly what we want to do. To create a video or GIF of the past, we need a way to continuously store what is happening on the screen at any given point. For encoding reasons, we chose to record GIFs at 25 FPS, but technically this can be anything we want, especially if we're focused on recording an mp4 instead.

{{< comment text="A GIF is a series of images separated by some delay. The delay is encoded in 100ths of seconds, so it's good to pick a FPS which evenly divides 100." >}}

What this ultimately means is that if we want to remember the last `n` seconds of gameplay, we'll need to store `25*n` frames in memory and continuously remove the oldest frames when adding the latest frame. We need the capturing and storing of this data to be fast enough that we can reasonably perform the action every 40ms, without introducing too much lag.

Then, we need to handle how the frame data is saved as a file. We expect the player to press a button to prompt the save. At this point, all of the viewport frame data needs to be processed to turn into a video. This ultimately means encoding every frame in some image format which is then compressed into some video format (such as mp4) or a GIF.

Continuously capturing frame data and creating a video from this data are essentially two completely independent pieces of work, but they need to be aware of each other. In particular, we expect the creation of the video to be computationally heavy so we want to make a worker thread thread to do the work in parallel to the game. This means ensuring we can package the frame data in a thread safe manner.

{{< comment text="Another option not explored in this post at all would be to capture game input and then play back all these inputs when the user asks to save the clip. This would have to pause gameplay but probably not introduce any lag during the gameplay before the clip." >}}

## Continuously Capturing Viewport Textures

### Ring Buffers

Before tackling how we obtain each frame, let's discuss how we can manage the memory of the frame data itself. Our solution uses something called a ring buffer. The idea is that we store both an `Array` together with an `int` type which indexes the ring buffer. Adding a frame to the array means storing the value at the current index, then incrementing the index modulo the fixed size.

A sketch of this in code would look like this:

```gdscript
# These constants can be freely chosen to balance memory/performance
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

Reading the frames in order when needed is then as easy as:

```gdscript
for i in BUFFER_SIZE:
	var frame: Image = ring_buffer[(buffer_index + i) % BUFFER_SIZE]
```


### Saving the Texture Image

With an efficient memory structure to hold the frame data, we now need to make a decision about exactly what data we're saving for each frame.

This point is where memory considerations need to be made. Our pixel art game runs in a `480x270` viewport, but is then upscaled to a much higher resolution to allow for HD elements. There is a 16x memory cost in storing the `1920x1080` viewport texture compared to the low-res `480x270`. As a result, we decided to capture a `SubViewport` which contained only the low-res gameplay elements which means all UI and other HD elements introduced into the game are "invisible" to our screen capture.

As explained in [Perfecting 36 Year Old Rendering in a Modern Engine](/posts/pixel_perfect), we actually have two low resolution `SubViewport` nodes within the game to ensure particles behave as we want. As a result we can't simply call a texture directly from where the game is drawn. Instead, we make a new `SubViewportContainer` with the following structure:

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

by calling `ScreenRecorder.register_viewport(self)` within the script of `RecordingSubViewport`. For gameplay, this viewport is useless, so we set the viewport rendering mode to `DISABLED` and then set it to `UPDATE_ONCE` only on the frame we want to capture before turning it off again.

With `target_viewport` now capturing what we want, the easiest solution is to then save to the buffer the image directly: `target_viewport.get_image()`, which returns an `Image` type. The issue with this method is that it introduces latency into the game. This is because the CPU has to wait for the texture from the GPU. If the GPU is busy, the CPU hits a wall and has to wait, causing lag. Later in the blog we talk about some other ideas, but storing the image data itself is what we use and the FPS of the game seem to drop from about 120+ to 80-110 FPS while the recording is active, which is something we can work around for now. 

With the small resolution image, because the game is pixel-perfect, we can apply nearest neighbour scaling to the GIF or video at creation to get higher resolution files if needed. For use within this blog we can actually use the scaling within the browser by setting `image-rendering: pixelated;` as a property keeping the file size smaller.


### Triggering Frame Capture

With a ring buffer in place and a way to save each individual frame, we now need to hook up various signals to ensure that we are consistently saving frame data to allow the resulting clip to run at the chosen FPS which matches the game itself. At 25 FPS, we need to trigger capture every 1/25 seconds or equivalently every 40 ms.

The rough set up is as follows. We create a constant `TICK_LENGTH` equal to the tick length (0.04s). We then set a timer variable `tick_time` at `_ready()` equal to this value. Within the `_process(delta: float)` method, we decrease `tick_time` and if this value is non-positive, we trigger the code to capture a frame and add `TICK_LENGTH` back to `tick_time`.

However, we need to be careful that we only capture the frame after the GPU has finished drawing. To abstract this, we instead simply update `waiting_for_frame: bool` to be `true` within the `_process()` method. Then by connecting a method to the `frame_post_draw` signal, we can ensure that the frame data is only captures after the full draw.

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


## A Clip of the Past

We now have everything we need to create a video or GIF at any given moment. We can hook up a listener for `_input()` which calls `_start_gif_export()` on the player's input (we chose `G` for GIF). The main thing we need to do now is ensure is we can offload all of the work of GIF creation into a parallel CPU thread.

In Godot, we can make the `WorkerThread` thread as easily as `Thread.new()`, 
then all we have to do is copy all mutable data to ensure the work done is thread safe, in our code it looks like this

```gdscript
func _start_gif_export() -> void:
	# Snapshot the buffer immediately on main thread — fast
	var buffer_copy = ring_buffer.duplicate()
	var index_copy = buffer_index

	if encode_thread.is_started():
		encode_thread.wait_to_finish()
	encode_thread = Thread.new()
	encode_thread.start(_encode_threaded.bind(buffer_copy, index_copy))
```

Now the final decision is how to encode the frame data into a GIF, at a high level there's two options:

1. Render the GIF within Godot itself by processing the `Image` data.
2. Save all frame data to disk as a list of PNG files and then use an external binary dependency to process this data into a GIF

### A GDScript Native Solution?

So option 1 is easier that you would think, thanks to the plugin [godot-gdgifexporter](https://github.com/jegor377/godot-gdgifexporter) which has created a pure gdscript GIF exporter. This is what I went with first, and I managed to make it work, but with some issues which meant the idea was abandoned.

The main issue was that some aspects of the code were in some way not thread safe. Which means that creating the GIF in a `WorkerThread` crashed the game... I then tried running the code on the main thread and it "worked" (I had a GIF)! However, it took more than 10s to create it and the game lagged down to 1 FPS during saving. 

This method could work better with a bit more work but ultimately I abandoned it in favour for option two. The right thing to do is probably refactor the whole thing to find the thread safety bug.

### Creating GIFs with FFMPEG

The second option is to create a GIF using some general purpose tool, such as `ffmpeg`. To experiment with arguments, I took the frame data and dumped it as PNG files. Then, I made a simple script to run `ffmpeg` to first generate a palette (GIFs are forced to use a maximum of 256 colours) and then a second call to make a GIF from the PNG data and the freshly generated palette. The result was the following:

{{< pixel_art src="gif/gif_making/bg_ffmpeg.gif" scale="two" alt="A  GIF made using FFMPEG where the generated palette breaks intended art style" caption="The standard flags for palette creation favour the most popular colours in the frame data, which accuratly captures the background well but corrupts the rendering of the player and other small intractable objects such as the mushroom seen on the left" >}}

Now the first option I tried was to try and remove a bunch of the effects we have in post rendering to keep the total palette of the level down to 256 colors. In this case, it seemed to work:

{{< 
	pixel_art 
	src="gif/gif_making/nbg_ffmpeg.gif" 
	scale="two" 
	alt="A GIF made using FFMPEG where the generated palette works due to less background effects" 
	caption="With less variation in the background, there's space in the palette for the character's colours to remain true" 
>}}

But this had an important issue. We can manually toggle effects for crisper GIFs without a problem, but as the game grows in complexity we expect more shaders and other changes to start changing the total colour count. If the colour space naturally grows beyond 256 colours during development this bug will reappear in a way which is much harder to manage.

There were a few different ideas I cycled though:

1. Can I force the player colours into the palette by feeding in the player image into the palette generation? This in fact did work, but then I realised the blue mushroom was still corrupt. I could add this blue in as well, but then when do I stop? There will be many unique elements in levels with small distinct colours and I can't account for them all without running out of colours generally!
2. Can I just use a different set of arguments to `ffmpeg` to get a colour palette which selects for lots of different hues instead of from the most common? I think maybe you can, but I couldn't figure it out from the documentation.
3. Are all libraries going to behave the same? Maybe I can try something other than `ffmpeg`?

### Creating GIFs with Image Magick

So `ffmpeg` may have been one option, but it's certainly not the only one. Another program, [Image Magick](https://imagemagick.org/command-line-options) is something I had used in the past for other image manipulation. As this was a dev tool, I had no issue with asking the others to install the binary to enable this feature. Trying it out, the converted GIF took slightly longer to be made, but the resulting colours worked much better, in both the clips with and without background effects.

{{< 
	pixel_art 
	src="gif/gif_making/bg_imagemagick.gif" 
	scale="two" 
	alt="A GIF made using Image Magick where the generated palette fits our game better due to a different sampling method which catches a wider range of hues" 
	caption="The Image Magick generated palette fits our game better due to a different sampling method, which catches a wider range of hues and a truer representation of the game" 
>}}

### Direct Comparison

If you're interested, here's two sliding windows which directly compare frames from each GIF, comparing the same rendered frame from Image Magick and FFMPEG.

{{< 
	pixel_slider 
    src1="/png/gif_making/bg_ffmpeg_15.png" 
	src2="/png/gif_making/bg_imagemagick_15.png" 
	alt1="A cropped gif made using FFMPEG with background effects"
	alt2="A cropped gif made using Image Magick with background effects" caption="A direct comparison between FFMPEG and Image Magick generated GIFs when background effects are on, leading to a large colour space in the game frame data. The resulting GIF produced by Image Magick handles the player and mushroom colours much better." 
	scale="two" 
	label1="Image Magick"
	label2="ffmpeg"
>}}

{{< 
	pixel_slider 
    src1="/png/gif_making/nbg_ffmpeg_84.png" 
	src2="/png/gif_making/nbg_imagemagick_84.png" 
	alt1="A cropped gif made using FFMPEG without background effects"
	alt2="A cropped gif made using Image Magick without background effects" caption="A direct comparison between FFMPEG and Image Magick generated GIFs when background effects are off, reducing the colour space of the frame data. The resulting GIFs are nearly identical." 
	scale="two" 
	label1="Image Magick"
	label2="ffmpeg"
>}}

At this point, I was really happy with the GIFs I was getting from Image Magick and the last step was to plug in the binary call within Godot. This is exceptionally easy with the `OS.execute` command which allows running commands directly from the engine! There's some string formatting to do to ensure the binary arguments are well formatted but the entire function of:

1. Saving all frames as a PNG
2. Processing the PNG frames into a GIF
3. Saving the GIF and deleting the temporary PNG files

was fairly easy to write and is copied below:

```gdscript
func _encode_threaded(buffer_copy: Array[Image], index_copy: int) -> void:
	# write PNGs to a temp directory
	var tmp_dir = OS.get_user_data_dir() + "/gif_tmp"
	DirAccess.make_dir_absolute(tmp_dir)

	for i in BUFFER_SIZE:
		var frame: Image = buffer_copy[(index_copy + i) % BUFFER_SIZE]
		if frame == null:
			continue
		var path = "%s/frame_%04d.png" % [tmp_dir, i]
		frame.save_png(path)

	# Save the GIF to the specified directory
	var output_path = (
		output_dir + "/recording_%s.gif" % Time.get_datetime_string_from_system().replace(":", "-")
	)

	# The magick call needs:
	# - The delay time
	# - Then the files
	# - Then everything else
	var magick_call = ["-delay", str(roundi(100.0 / float(CAPTURE_FPS)))]
	for i in BUFFER_SIZE:
		var path = "%s/frame_%04d.png" % [tmp_dir, i]
		magick_call.append(path)
	var magick_args = [
		"-loop", "0", "+dither", "-colors", "256", output_path
	]
	magick_call.append_array(magick_args)

	var output = []
	var exit = OS.execute(magick_path, magick_call, output, true)
	if exit != 0:
		push_error("image magick encode pass failed")
	else:
		print("GIF saved to: ", output_path)

	# Clean up temp files
	for i in BUFFER_SIZE:
		DirAccess.remove_absolute("%s/frame_%04d.png" % [tmp_dir, i])
	DirAccess.remove_absolute(tmp_dir)
```

### Encoding to Video

During the writing of this blog, I started also experimenting with recording directly to mp4. This results in being able to make a file directly from the saved PNG files and the colour capture does not have the 256 colour restriction, allowing the video to closely match the game. Included below is a `480 x 270` resolution video, upscaled using the nearest neighbour CSS property, but the mp4 compression is so good that you can upscale to 1080p and still have a clip under one megabyte.

{{< 
  pixel_video 
  src="/mp4/gif_making/nbg.mp4" 
  w="480"
  h="270"
  scale="two"
  caption="An mp4 created using FFMPEG with the same input PNG as the GIFs shown above" 
>}}

The only downside with th mp4 is that cropping the video after the fact. This has a solution in our script, where you can set parameters to crop the images before the video is made, but this requires manual work and the flexibility of the GIF means we'll probably end up using that more when creating resources for the blog (where as the mp4 is better for sharing bugs / small clips internally as a team).

The creation of both files in the code after the update to have both options now looks like this:

```gdscript
	var timestamp = Time.get_datetime_string_from_system().replace(":", "-")
	var output = []
	var any_failed = false

	if CAPTURE_GIF:
		var output_path = "%s/recording_%s.gif" % [output_dir, timestamp]
		var magick_call = ["-delay", str(roundi(100.0 / float(CAPTURE_FPS)))]
		magick_call.append_array(saved_paths) # Created while saving the PNG files
		magick_call.append_array(
			[
				"-loop",
				"0",
				"+dither",
				"-colors",
				"256",
				output_path
			]
		)
		var exit = OS.execute(magick_path, magick_call, output, true)
		if exit != 0:
			push_error("ImageMagick failed:\n" + "\n".join(output))
			any_failed = true
		else:
			print("GIF saved to: ", output_path)

	if CAPTURE_MP4:
		var output_path = "%s/recording_%s.mp4" % [output_dir, timestamp]
		var mp4_call = [
			"-y",
			"-framerate",
			str(CAPTURE_FPS),
			"-i",
			tmp_dir + "/frame_%04d.png",
			"-vf",
			"scale=4*iw:4*ih:flags=neighbor,format=yuv420p",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			output_path
		]
		var exit = OS.execute(ffmpeg_path, mp4_call, output, true)
		if exit != 0:
			push_error("ffmpeg mp4 failed:\n" + "\n".join(output))
			any_failed = true
		else:
			print("MP4 saved to: ", output_path)

	# Cleanup
	for path in saved_paths:
		DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(tmp_dir)

	call_deferred("_set_ui_status", "Recording Failed" if any_failed else "Recording Saved", 1.5)
```


### Some UI Touches

Lastly we'll need to hook in some UI which tells the player when they have started clipping, when it finishes and whether the clip succeeded or failed to be saved.

We did this by adding a `RecordingStatusLabel` node to our `UI` canvas and registering this with the global `ScreenRecorder` in the same way we registered the `SubViewport`. Then we wrote the following helper function

```gdscript
func _set_ui_status(text: String, auto_hide_seconds: float = 0.0) -> void:
	"""
	Sets a label in the UI
	"""
	if ui_label == null:
		return
	ui_label.text = text
	ui_label.visible = true
	if auto_hide_seconds > 0.0:
		await get_tree().create_timer(auto_hide_seconds).timeout
		ui_label.visible = false
```

Which shows and updates the label, and optionally auto-hides the label after a window.

## Future Improvements

I'm still not totally happy with the solution, in particular, I feel as though there must be an async way to obtain the texture data from the GPU without stalling the CPU during the frame capture. I would love to add to the buffer the texture `RID` or some other lighter data structure which I could then create an image from using the worker thread instead of the main game thread.

This is something I am unexperienced with and potentially the solution is "easy" when you know what you're doing.

The problem seems to be in how we could offload the request from the GPU into memory from a worker thread instead of a main thread. As far as I can tell from the documentation, `RenderingSever` can directly request texture data from the `RID` of the texture, but that this work has to be done on the main thread?

Alternatively, there is the `RenderingDevice` but this requires building the game in Forward+ rather than Compatibility mode and I'm not sure we want to go down this route. The `RenderingDevice` does include an async call to the `texture_get_data_async(texture: RID, layer: int, callback: Callable)`, but this hasn't been properly explored yet.


