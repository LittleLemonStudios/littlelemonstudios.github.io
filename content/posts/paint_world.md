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

When creating a room Godot really shines at allowing the iterative gameplay loop to polish tile placement. Once a respawn location is included and the tilemaps are available, you can have the game running and edit the tile placement in real time. This means on side of my screen can have a game running while the editor is open next to me for tweaks.

In contrast, for world building, we have a world scene (with world decorations) and then each room is a Level node which are then arranged within the scene. Levels which feed into each other have a space to act as a "door" and leaving one Room (which formally has an area 2D `RoomArea2D`) and entering the next, ensures the level is fresh and running upon entering with no load between rooms.
Real time editing of the world means clicking and dragging the world scenes and ensuring the connect properly means editing the tilemaps of each level to have everything aligned. This is boring and fustrating work.

So, as programmers like to do, instead of creating levels for our game, I instead created a tool to do the work of world sketching for me. The general idea is this: I want to be able to draw a world, colour blocking out the floor, room size and hazard placements. Then, I want a script to ingest this image and cut the image up into rooms. Each room is then processed and a `Level` node is made. This lets me very quickly sketch a world with 10-30 rooms all nicely connected and then each room can be hand-tweaked in the usual way.

I do not need, or want the finished output of the tool to be the game, but being able to carve out rooms and decide how they all connect with each other removes a huge amount of boring `Room` duplication and let's me focus on the important part of making each room itself fun and challenging.

## Sketching a World in Paint

- Basic choice for ground, hazards and respawn
- Adding in collectibles
- Creating a Room from three pixels (how we do room detection)

## Creating a World from an Image

- Consuming the image into pixels
- Finding every room.
- Binning all data into each room
- Creating a room from a bin

## Future Work

- Export a world to a PNG and allow this tool to become a full-fledged level editor
