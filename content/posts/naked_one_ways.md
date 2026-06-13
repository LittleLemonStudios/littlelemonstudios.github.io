+++
title = "Avoiding Edge Collision with One Way Platforms"
date = 2026-06-13
tags = ["godot", "platforming"]
description = "Finding a (over engineered?) solution to one-way platform edge collision."
draft = false
+++

{{< todo text="Picture of Pomu looking up at a one way platform." >}}

If you decide to make a platforming game with your friends, at some point along the way you are going to need to make some platforms. You'll probably start with some ground, then gaps in the ground to jump over and some spikes to avoid, but pretty soon you'll need a "one way" platform which you pass through from below and land on from above.

The one way platform has been a staple of platforming games, it's even in Super Mario Bros which was made before any of us (1985):

{{< todo text="Super mario one one way." >}}

They're also incredibly useful for level design when you want to force certain movement patterns. Getting one ways feeling good in our game is one of those non-negotiables if we want the game to feel good.

## One Way Platforms at a Click of a Button

Luckily in Godot for a lot of cases, the one way platform can be created with a click of a button. For `CollisionShape2D` there's the `one_way_collision` property which can be toggled to `true` and for ground created with a tile map, you can set the tiles polygon to have one way collision in a similar way when painting the collision area.

As far as we understand, when a collision is set to one way then collision is off if the player moves up through the shape and is turned on as the player falls down through the shape. This allows you to jump under the area and land on top of it seamlessly. It's amazing how quick and easy it is to get something moderately complex from a physics point of view working with a click of a button.

{{< todo text="Gif of a one way platform with walls either side working" >}}

## Dealing with Naked One Way Platforms

However there seems to be an edge case with how these collisions work which is at odds with how we have designed the game. The current set up is our character has a solid rectangle collision shape which interacts with the world. This collision is what handles ensuring the player stays on the floor, bumps into a ceiling and cannot walk through walls.

Because of this collision shape though, if the player enters a one-way from the side at just the right (wrong?) height, you can catch on the side of the collision as you fall and the one way platform then appears to have a hard edge. This means if you make a Mario style platform then your character can collide into the side of it rather than passing through.

{{< todo text="Gif of colliding with the side of a platform with and without collision shapes enabled" >}}

This obviously looks wrong and feels terrible for the player, so we need to fix it.

## Some Rejected Ideas

Before sharing our solution here's a couple of other ideas which we didn't follow:

1. Always cover the edge of the one-way. This would work, but was far too limiting for the level design we want to do.
2. Never allow a player to jump to this "bad" height by placing all platforms in the right place. This could work, but because of the way we can platform off the magic pollen, there's too much variance with "how high" we can jump.
3. Remove the use of `move_and_slide()` and instead check all collisions within `move_and_collide()` skipping collisions with one way platforms when we're at the wrong height. This could work, but we really wanted to try and use as much of Godot as possible and this kind of hack on something as core as layer movement felt like the wrong choice.
4. Change the player's collision to use separation rays instead and try and fix it this way. This option is something we almost did, but so much of what we have coded is centred around the rectangle shape (including ground pounds smashing blocks), we were loathed to change something this fundamental to the player.

## Our Solution

Instead of editing the player, we have complicated the one way platform instead. We have defined a new `StaticBody2D` which uses a `SegmentLine2D` for the collision shape, which has one way collision enabled. We hoped the segment line would be enough, but the bug remained for exactly the  same reason: the player collides with the line half way through the rectangle and gets caught.

{{< todo text="Gif of example here too?" >}}

We then add to the new one way platform an area which is larger than the platform. This `Area2D` listens for the `Player` node. When a player enters the `Area2D` the platform stores the node reference in the `player` variable which is later set to `null` on the exit body signal.

{{< todo text="Screenshot of the node set up" >}}

When `player` is not `null`, then the `Area2D` controls the collision of the `SegmentLine2D` within the physics process. When the player's location is below the platform, the collision of the `SegmentLine2D` is disabled, and when the player is above the line it's enabled. This means when the player tries to collide with the side of the line, the `Area2D` catches this, turns off collision and the player passes straight through. Then, if the player jumps on it regularly, the position ensures the collision is enabled and the platform works.

```gdscript
TODO code snippet of enabling / disabling the collision
```

Ultimately, this is similar to replacing the player's collision shape with a `SegmentLine2D` too, but without sacrificing that we can "bump" into walls with our rectangle as you would expect for a solid player character. 

{{< todo text="Gif of it working nicely" >}}

## Ensuring this works with TileMapLayers

One of the next things to sort is allowing the `TileMapLayer` one way collisions to work in the same way. Here we can't do the same tricks, but what we can do is add these generic one way collisions to every one way tile at `_ready()`.

```gdscript
TODO code snippet of adding the tiles
```

As a result, we can paint our scene with one way tiles from the tilemap and instead of coding the one way collision into the tilemap, this is all handled by the generic static body and the tilemap just handles the visuals!

{{< todo text="Screenshot of the platform with collision shapes enabled" >}}

{{< idea title="comment" text="There's an optimisation to explore here. Currently if there are n tiles placed which are labeled as 'one way' then we created n generic one way platforms and add them all to the scene. One could imagine instead looking for lines of one way tiles and adding longer sprites (so 5 adjacent tiles need only one StaticBody2D). However, to do this you would need to dynamically set the collision shape of each one to the correct length and so you may end up with more complex scenes as instead of a single node passed many times as reference you need many different collision shapes created instead. Something to think about." >}}

## Some Extra Leniency  

Now we have custom code for all our one ways which avoid the side collision, we can write more code on top of that. Why not?!

For now, the only additional thing we have included is a leniency mechanic for when you "just" miss a one way from below.

Before we check the player's position for the collision, we also check how close the player is to the top. If the player is going to miss it by a small number of pixels (say the player is moving down and is two pixels from the top) then we can move the player up by some margin, snapping them to the platform.

```gdscript
TODO: code from the platform snapping
```

{{< todo text="Gif of the snapping" >}}

We love little tricks like this which help the player, and it's something we think about a lot because of the fantastic blog [Celeste & Forgiveness](https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html). It feels good that the work of making the custom one way to fix a bug also allowed us to make the platforms feel more fun for the player.

{{< todo text="Image to end the blog." >}}
