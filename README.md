# Obsidian Image Actions

Quickly copy any image in Obsidian to your clipboard, reveal it in your file
explorer, or open it in your browser — straight from a hover toolbar on the
image.

## Features

- **Hover toolbar**: Move your mouse over any image and a small toolbar appears
  in its bottom-right corner. It works in both Reading view and Live Preview,
  for vault images (`![[image.png]]`) and external images (`![](https://…)`).
  - **Copy to clipboard**: copy the image so you can paste it anywhere.
  - **Reveal / Open**: for a local image, reveal it in your system file
    explorer (Finder / Explorer); for a remote image, open it in your browser.
- **Mobile**: touch and hold an image for one second to copy it.

## Manual Installation

1. In Obsidian, open Settings > Community plugins.
2. Turn off Restricted mode.
3. Click on Browse community plugins.
4. Search for "Image Actions".
5. Click Install.
6. Once installed, toggle the plugin on in the list of installed plugins.

## Usage

### Desktop

1. Hover over an image. A toolbar appears at its bottom-right corner.
2. Click the **copy** icon to copy the image to the clipboard.
3. Click the **folder** icon to reveal a local image in your file explorer, or
   the **external-link** icon to open a remote image in your browser.

### Mobile

1. Touch and hold an image for one second to copy it to the clipboard.

## Notes

- Images are copied as PNG (re-encoded via a canvas), so any format the
  renderer can display can be copied.
- Copying a remote image requires it to be served with CORS headers that allow
  the page to read it; otherwise only locally-stored images can be copied.

Enjoy your enhanced Obsidian experience with Obsidian Image Actions!
