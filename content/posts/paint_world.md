+++
title = "Creating a Game Inside Paint"
date = 2026-07-27
tags = ["godot", "dev-tools"]
author = "jack"
description = "How we can sketch world designs using simple images"
draft = false
+++

{{< 
  pixel_video 
  src="/mp4/paint/blink_jump.mp4" 
  w="840"
  h="540"
  scale="one"
  caption="Places to be, goo to avoid."
>}}


Creating a good precision platformer requires being precise with where you place your platforms. It means hand-crafting every room, carefully placing every tile and being creative in allowing (multiple?) complex paths between a start and an end. I think the great platforming games are great because of the care and attention given at the smallest scale of the game. If each individual obstacle is fun and challenging to overcome, the larger areas or zones essentially play themselves.

If I had to point to the games I love most of this genre, this type of game design feels central to them. Super Mario World, The End is Nigh, Celeste, and various ROM-hacks and mods of these games are similar. Every room you enter shows you a challenge which you overcome, but how these challenges are stitched together feels almost invisible. The End is Nigh (and the cartridges) are mainly long hallways of levels. Super Mario World hacks also favour long single screen high rooms of challenges. Sometimes short detours for collectibles are given, but compared to the large and interconnected worlds of Metroid, Animal Well or Hollow Knight, the shape of these worlds are simple.

For Blink, at least currently, we want to try and find a middle ground between these two games. We want to create a world which feels like you're exploring, but with a clear linear goal in each room. I think, ultimately, what this will mean is that more rooms will have movement different to the "always move right". The game is still very early in development, but these kinds of thoughts are what motivate the rest of this blog.

When creating a room, Godot really shines at allowing the iterative gameplay loop to polish tile placement. Once a respawn location is included and the tilemaps are available, you can have the game running and edit the tile placement in real time. This means one side of my screen can have a game running while the editor is open next to me for tweaks.

In contrast, for world building, we have a `World` scene (with world decorations) and then each room is a `Level` node which are then arranged within the scene. Levels which feed into each other have a space to act as a "door" and leaving one Room (which formally has an area `RoomArea2D`) and entering the next, ensures the level is fresh and running upon entering with no load between rooms.
Real time editing of the world (from the perspective of rearranging room locations) means clicking and dragging the `Level` scenes and ensuring they connect properly means editing the individual tilemaps of each level. This is boring and frustrating work.

So, as programmers like to do, instead of creating levels for our game, I instead created a tool to do the work of world sketching for me. The general idea is this: I want to be able to draw a world, colour blocking out the floor, room size and hazard placements. Then, I want a script to ingest this image and cut the image up into rooms. Each room is then processed and a `Level` node is made. This lets me very quickly sketch a world with 10-30 rooms all nicely connected and then each room can be hand-tweaked in the usual way.

I do not need, or want the finished output of the tool to be the game, but being able to carve out rooms and decide how they all connect with each other removes a huge amount of boring `Level` duplication and lets me focus on the important part of making each room itself fun and challenging.

## Sketching a World in Paint

### Keep it Simple

I have a tendency to procrastinate from Game Design by working on Game Design Tooling, so while I procrastinate from making a game by writing about how I made a Game Design Tool (procrastination inception anyone?), I'll also try and be transparent about how I at least tried to keep things simple.

When sketching the world, the very minimal pieces I wanted for each room was:

1. A way to have multiple rooms generated from a single file, where relative positions were respected.
2. A way to have both ground and gaps in the ground captured by the file, so I could sketch where the walls, floors and doors would be between rooms.
3. Placement of other common nodes I have in most rooms: respawn locations, collectibles and hazard placements.

### Design by Colour

The idea I had was to make a PNG where each pixel in the image corresponded to one tile (an 8x8px square). I could then have one colour for the ground, one for hazards, one for collectibles, one for respawn etc.

```gdscript
const C_HAZARD := Color8(255, 0, 0)
const C_GROUND := Color8(0, 0, 255)
const C_SPAWN := Color8(255, 0, 255)
const C_COLLECT := Color8(255, 255, 0)
```

For the room shape itself, I couldn't do something quite so easy, as I needed a way for a colour to dictate the room boundaries (any arbitrary rectangle) in a way where each room could be extracted from the PNG. The idea I had was to use two colours:

```gdscript
const C_ANCHOR := Color8(0, 255, 0)
const C_BOUND := Color8(0, 255, 255)
```

The `C_ANCHOR` would be a single pixel denoting the top-left corner of the room. Then a secondary `C_BOUND` can be used to pick out both the top-right and bottom-left corners. The idea was my parser would count the number of anchor pixels to get the number of rooms. Then, the room boundaries can be found by walking right and down from the anchor to get the right and bottom bounds respectively (which is enough to draw the whole rectangle).

With the correct parser, I should then be able to draw many connecting rooms of arbitrary size, erase pixels to open up doors and then draw in rough room shapes with respawn locations, collectibles and hazards to give a general framework to start polishing from.

{{< comment text="I picked pretty ugly colours for the parser, which is a shame but was done with the idea that I want things to be easy to work with. I could have used anything (and got something nicer to look at), but using #0000FF as my blue for floor meant I wouldn't have to create and import in a level creation palette. For now, things work fine with the primary and secondary colours just fine"  >}}


{{< todo text="Example of a room image" >}}


## Creating a World from an Image

With the plan above, the rest of the effort of the tooling was mainly just a case of parsing PNGs and creating nodes. There's nothing particularly clever I wrote, nor any strange Godot bugs I had to overcome, so here's a visual example of how an image becomes a level:

{{< todo text="Level from the above room image" >}}

and then how we can make an entire world:

{{< todo text="Image of world with many rooms" >}}
{{< todo text="Godot screenshot of the parsed world" >}}

For those interested in the code, I'll give a sketch of some of the bits to give an impression of how easy Godot makes creating a tool like this.

### A Question of Scale

Our game viewport measures 480 x 270 pixels, so one option could have been to work at this resolution with an 8px brush to draw everything. This would have given a lot of control, but was more annoying to get everything grid aligned. The other obvious option is to work with single pixels and scale up by a factor eight. This is indeed what I do, but one issue is 270 / 8 is non-integral, and I cannot create a 60 x 33.75 pixel room.

What I do instead is have 60 x 34 pixels be the minimum room size. Any room which has bounds equal or less than this is treated as a single screen `480 x 270` room, whilst anything bigger has the room limits created from the explicit bounds from the green and cyan pixels.

{{< comment text="A side-effect of this is that when I place all the rooms in the grid, vertically stacked rooms will sit tiled at 272 pixels and so the room position starts to drift with the 270 pixel height. This could be fixed with code, but ultimately it felt easier to just tweak a few nodes within the world after the tool has run than to complicate the parsing any further." >}}

### Pixels to Data

The first step is to extract out the data from the image into Godot, which is very easy as once the PNG is loaded as an `Image` type we have direct access to pixel colour:

```gdscript
func scan_image(img: Image) -> Dictionary:
	var buckets := {
		"ground": [],
		"hazard": [],
		"spawn": [],
		"anchor": [],
		"collectible": [],
		"bound": [],
	}
	for y in img.get_height():
		for x in img.get_width():
			var c := img.get_pixel(x, y)
			if c == C_GROUND:
				buckets.ground.append(Vector2i(x, y))
            # Note that for both the anchor and bounds we also treat this pixel as floor
			elif c == C_ANCHOR:
				buckets.anchor.append(Vector2i(x, y))
				buckets.ground.append(Vector2i(x, y))
			elif c == C_BOUND:
				buckets.bound.append(Vector2i(x, y))
				buckets.ground.append(Vector2i(x, y))
			# ... etc
	return buckets
```

This system lets me add more buckets in the future by simply having more arrays and more colour constants for each node type.

### Data to Rooms

With the whole room ingested into Godot, now we need to partition all of this data into rooms. The idea is that for each anchor, I can find each room boundary. Then with each room boundary, I can partition the pixel data into each room:

```gdscript
func _compute_layout(buckets: Dictionary, image_size: Vector2i) -> Dictionary:
	var room_data := compute_room_rects(buckets.anchor, buckets.bound, image_size)
	var room_rects: Array[Rect2i] = []
	var room_camera_sizes: Array[Vector2] = []
	for rd in room_data:
		room_rects.append(rd.rect)
		room_camera_sizes.append(rd.camera_size)

	return {
		"room_rects": room_rects,
		"room_camera_sizes": room_camera_sizes,
		"ground_by_room": partition_pixels(buckets.ground, room_rects),
    # ... etc
	}
```

Exactly how this is done ends up being a bit verbose... but if you've made it this far maybe you're interested:

```gdscript
func compute_room_rects(anchors: Array, bounds: Array, image_size: Vector2i) -> Array[Dictionary]:
	var rects: Array[Dictionary] = []
	for anchor in anchors:
		var right := _find_right_bound(anchor, bounds, image_size)
		var bottom := _find_bottom_bound(anchor, bounds, image_size)
		rects.append(_build_room_rect(anchor, right, bottom))
	return rects


func _find_right_bound(anchor: Vector2i, bounds: Array, image_size: Vector2i) -> Dictionary:
	var right_bound: int = image_size.x
	var found := false
	for b in bounds:
		if b.y == anchor.y and b.x > anchor.x and (not found or b.x < right_bound):
			right_bound = b.x
			found = true
			break
	return {"value": right_bound, "found": found}


func _find_bottom_bound(anchor: Vector2i, bounds: Array, image_size: Vector2i) -> Dictionary:
	var bottom_bound: int = image_size.y
	var found := false
	for b in bounds:
		if b.x == anchor.x and b.y > anchor.y and (not found or b.y < bottom_bound):
			bottom_bound = b.y
			found = true
			break
	return {"value": bottom_bound, "found": found}


func _build_room_rect(anchor: Vector2i, right: Dictionary, bottom: Dictionary) -> Dictionary:
	var width_tiles: int = (right.value - anchor.x + 1) if right.found else (right.value - anchor.x)
	var height_tiles: int = (
		(bottom.value - anchor.y + 1) if bottom.found else (bottom.value - anchor.y)
	)
	var partition_rect := Rect2i(anchor, Vector2i(width_tiles, height_tiles))

	var width_px: float = (
		ROOM_SIZE_PX.x
		if (not right.found) or width_tiles <= DEFAULT_ROOM_SIZE_TILES_W
		else width_tiles * TILE_SIZE
	)
	var height_px: float = (
		ROOM_SIZE_PX.y
		if (not bottom.found) or height_tiles <= DEFAULT_ROOM_SIZE_TILES_H
		else height_tiles * TILE_SIZE
	)

	return {
		"rect": partition_rect,
		"camera_size": Vector2(width_px, height_px),
	}
```

The benefit is that once you have all the room bounds correctly configured (notice we have a slightly different notion for the bounds of the pixel rooms and the actual bounds used for our camera control etc) we can partition the rooms themselves using a very easy check:

```gdscript
func partition_pixels(pixels: Array, room_rects: Array[Rect2i]) -> Array:
	var out: Array = []
	for i in room_rects.size():
		out.append([])
	for p in pixels:
		for i in room_rects.size():
			if room_rects[i].has_point(p):
				out[i].append(p)
				break
	return out
```

### Creating Rooms

With all the data partitioned into rooms, we need to normalise all the pixel locations based off the anchor location, and from this make each room its own `Level` scene. These are then saved, then instantiated and added into the `World` scene, repositioned to the correct location using the anchor pixel.


```gdscript
func local_cells(pixels: Array, anchor: Vector2i) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for p in pixels:
		out.append(p - anchor)
	return out

func build_room_from_local(buckets: Dictionary, room_size_px: Vector2) -> Node2D:
	var root := Level.new()
	root.name = "Room"

	var ground := GROUND_TILEMAP.instantiate()
	ground.name = "Ground"
	if not buckets.ground.is_empty():
		ground.set_cells_terrain_connect(buckets.ground, GROUND_TERRAIN_SET, GROUND_TERRAIN,false)
	root.add_child(ground)
	ground.owner = root

	# ... everything else added in similarly

  return root
```

With these two pieces, a `Level` scene is created with only a few lines of code

```gdscript
func local_cells(pixels: Array, anchor: Vector2i) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for p in pixels:
		out.append(p - anchor)
	return out

func _build_and_instance_room(i: int, buckets: Dictionary, layout: Dictionary) -> Node2D:
	var anchor: Vector2i = buckets.anchor[i]
	var room_file := "room_%d" % i
	var room_path := "%s/%s.tscn" % [output_levels_dir, room_file]

	# Compute the local coordinates of every pixel to create the room scene 
	var room_buckets := {
		"ground": local_cells(layout.ground_by_room[i], anchor),
		# ...etc
	}

	# Create the level scene itself to edit later
	var room_root := build_room_from_local(room_buckets, layout.room_camera_sizes[i])
	save_scene(room_root, room_path)

	# Include the level scene into the world scene at the correct location
	var packed: PackedScene = load(room_path)
	var instance: Node2D = packed.instantiate()
	instance.name = "Room%d" % i
	instance.position = Vector2(anchor) * TILE_SIZE
	return instance
```

To make an entire world, we just iterate over each partitioned room, running the per-level functions for each bucket and save the whole thing to the editor.

## Future Work

The obvious extension to this work would be to create a png from a world and allow Paint (or any image editor) to be a fully working world editor. The main issue I have with this is many moving parts seem hard to capture. If I have a moving hazard or platform then I'll need colours for all of these. I would also need a way to show how fast they move, where they move to and where they start. This is of course all possible, but ultimately I think the complexity will started to be more costly than just editing in Godot. I think for now, having a very fast way to draw and create a dozen level nodes which are all imported (roughly) where we want them is a great start and any polishing of the tool would be better spent polishing the levels themselves!

{{< todo text="Ending video of moving between rooms?" >}}
