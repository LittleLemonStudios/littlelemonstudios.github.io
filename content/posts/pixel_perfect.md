+++
title = "Perfecting 36 Year Old Rendering in a Modern Engine"
date = 2025-03-12
draft = false
+++

Inspired by the games of our childhoods, Moss King is a tricky platforming game with beautiful pixel art created by our artist **Spooooky**. But unlike Super Mario World, the game itself is being built and rendered by Godot, an open source game engine which was designed to handle the complex graphics of modern games.

I (Jack) started to learn game design in Godot about a year ago when I had a month long "personal game jam" and made the small platforming game [Blink](https://supersingular.itch.io/blink), which achieved pixel perfect graphics in a simple way: the whole game was built at low resolution and then upscaled to the window size. This had a lot of benefits, namely being easy to implement which was a big deal as I started off knowing nothing about Godot. The downside was that I was stuck at the same resolution for everything in the game, which meant pixel fonts and UI.

For Moss King, the team has decided to hold onto this nostalgic look for the game, but we want to try and do the extra work at the rendering level so that we can use HD textures for things such as UI elements and fonts. This is "common" with modern pixel art games like Celeste, where you can make UI comfy to interact with while allowing the main game to look and feel like the games we remember from being kids.

There's a lot within Godot which makes this easy, and while we've had some hiccups along the way, progress is good. We may not be using the best solution, but this is what we're working with. As we've had to make some workarounds along the way, we thought we'd write a small blog about the design choices we've made so far.

## The Basic Set Up

The main idea is working with two separate rendering layers. The game world renders inside a `SubViewport` at 480 x 270, which scales exactly 4 times to 1080p. The UI lives in a `CanvasLayer` on top that renders at native resolution and is never scaled.

This means we can have animated buttons with a modern font animating at the native resolution, while the game itself can run in the smaller 480 x 270 resolution where the art and gameplay is computed.

```asm
World (Node2D)
├── WorldCanvas (CanvasLayer)
│   └── SubViewportContainer  [stretch = true, stretch_shrink = 4]
│       └── SubViewport  [size = 480×270]
│           └── [game world, player, environment]
└── UICanvas (CanvasLayer)
    └── fonts, HUD, menus...
```

To ensure nothing is blurred in the scaling, the texture filter of the subviewport must be set to nearest neighbour.

## Faking Pixel Perfect Alignment

Run like this, there's a visual issue. Although the pixels are now bigger, the player's location in space is a float and when moving through the world, the character and other moving objects can move freely across pixels, stopping mid-pixel, breaking the illusion that you're playing a game from 30 years ago on outdated hardware. Luckily, there's a simple fix for this. There's a value: `snap_2d_transforms_to_pixel`, which we can set to `true` in code (or by clicking a button in the inspector) which allows the player to move on subpixels, with float values for coordinates, but at render time everything is snapped to the grid allowing movement to feel smooth while looking discrete.

This set-up got us most of the way there and is how we have been developing the game over the past few months.

## Jittering GPU Particles

This is, we think, where we found our first bug, which is being tracked in the following [GitHub Issue](https://github.com/godotengine/godot/issues/120029).

The problem arises when we attach a `GPUParticle2D` node to the player and emit particles as the player moves through the game. I don't fully appreciate the bug (otherwise I would have made a PR fixing it) but the rough issue is that the particles are moving correctly in world space, but their screen positions get snapped to the pixel grid independently of their parent each frame. As a result, particles can drift by a pixel whenever the player has a sub-pixel component causing the particle to jitter in place while the player moved.

A simple fix is to take `snap_2d_transforms_to_pixel` and set it to `false`. This removes the jittering, but reintroduces the visual bug of walking on subpixels. 

Our fix to get the best of both worlds is to introduce a second subviewport for the particles to live in while keeping everything else in the snapped viewport. The workflow is roughly:

```asm
WorldCanvas (CanvasLayer)
├── SubViewportContainer  [stretch_shrink = 4]
│   └── SubViewport  [snap_2d_transforms_to_pixel = true]
│       └── [game world]
└── ShadowSubViewportContainer  [stretch_shrink = 4]
    └── ShadowViewport  [transparent_bg = true]
        └── Shadow (Node2D)
```

The `Shadow` node has the following code which clamps its position to the player while shifting the viewport around if the camera has moved it in the main viewport

```gdscript
func _physics_process(_delta: float) -> void:
    # Clamp the Shadow to the player's position
    global_position = GameManager.player.global_position

    # Move the shadow viewport in sync with the game one
    var main_vp = GameManager.player.get_viewport()
    get_viewport().canvas_transform = main_vp.canvas_transform
```

Then, we can keep all the particle nodes and function calls in the `player.gd` script as long as we call


```gdscript
func _ready() -> void
    ...
    _send_particles_to_shadow()

func _send_particles_to_shadow() -> void:
    for child in GameManager.shadow.get_children():
        if child is GPUParticles2D:
            child.queue_free()
    for child in particles.get_children():
        if not child is GPUParticles2D:
            continue
        particles.remove_child(child)
        GameManager.shadow.add_child(child)
```

When the player spawns, we pass by reference every `GPUParticle2D` from the player to the shadow, and the particles can emit and follow the player in a separate viewport and as we have disabled pixel snapping in the shadow all jittering has been removed.

{{< fig src="/gifs/BombBeetle.gif" alt="Bomb Beetle" caption="Here's a caption about the bomb beetle." >}}

## Opacity Issues

For the particles to live on top of the game, we need to set the background of `ShadowViewport` to be transparent. If nothing else is changed, we find that instead of blending into the background, particles intended to fade out instead fade to black:

The fix for this is to change the blend mode of the rendering, which we can do by changing the `blend_mode` of the `ShadowSubViewportContainer` to `BLEND_MODE_PREMULT_ALPHA`. This allows all the alpha values to be rendered correctly, except we found they weren't in the game?

The problem was made into a [GitHub issue](https://github.com/godotengine/godot/issues/120135) although it's not obviously a bug. The problem was that we had a `WorldEnvironment` node in `CANVAS` mode in the main game. The use of this affected both subviewports and for some reason changed the alpha blending. The fact alpha blending is affected seems to be a bug, but this hasn't been decided yet.

Luckily, the fix is simple, you can set one last setting in the shadow viewport:
`own_world_3d = true` which stops the `WorldEnvironment` from the game viewport interacting with the pixels at all.

## Current Solution

Putting this all together, we have the following structure to our `World` node:

```asm
World (Node2D)
 ├── WorldCanvas (CanvasLayer)
    ├── SubViewportContainer  [stretch = true, stretch_shrink = 4]
    │   └── SubViewport  [size = 480×270, snap_2d_transforms_to_pixel = true]
    │       └── [game world]
    └── ShadowSubViewportContainer  [stretch_shrink = 4]
        └── ShadowViewport  [size = 480×270, transparent_bg = true]
            └── Shadow (Node2D)
└── UICanvas (CanvasLayer)
    └── fonts, HUD, menus...
```

As we keep making the game, I'm sure this will get more complex (or less if we learn how to use Godot better) but for now we're really happy with how everything is looking!

