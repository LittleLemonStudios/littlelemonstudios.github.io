# Diary of the Moss King — Blog

A dev blog for the game, built with [Hugo](https://gohugo.io).

---

## Install Hugo

On **Mac** I just do:

```bash
brew install hugo
```

but you can look at [the hugo installation page for various systems](https://gohugo.io/installation/)

---

## Run locally

To run the site locally, use the command:

```bash
hugo server --buildDrafts   
```

Then open [http://localhost:1313](http://localhost:1313) in your browser. The site live-reloads as you save changes.

---

## Writing a post

Create a new file in `content/posts/` named `your-post-title.md`.

Every post needs a front matter block at the top:

```
+++
title = "Your Post Title"
date = 2025-03-12
draft = false
+++

Your content goes here.
```

Set `draft = true` while you're working on it — draft posts won't appear on the live site but will show locally if you run `hugo server -D`.

### Adding an image or gif

Drop the file into `static/gifs/` (or `static/images/`), then embed it in your post using the shortcode:

```
{{< fig src="/gifs/your-file.gif" alt="Description" caption="Your caption here." >}}
```

### Code blocks

Wrap code in triple backticks with the language name:

````
```gdscript
func _ready():
    print("Hello!")
```
````

---

## Publishing

Push to `main` — GitHub Actions deploys automatically.