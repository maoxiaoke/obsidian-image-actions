import {
	Notice,
	Plugin,
	Platform,
	Editor,
	MarkdownView,
	setIcon,
	FileSystemAdapter,
} from "obsidian";

// An image referenced from the markdown source: either a vault file
// (`![[name.png]]` / `![](relative/path.png)`) or an external/data URL
// (`![](https://...)`).
type ImageRef =
	| { kind: "vault"; name: string }
	| { kind: "url"; url: string };

const SUPPORTED_EXTENSIONS = ["bmp", "gif", "jpeg", "jpg", "png", "tiff", "webp", "svg"];

const BUTTON_STYLE = [
	"display: flex",
	"align-items: center",
	"justify-content: center",
	"width: 28px",
	"height: 28px",
	"padding: 4px",
	"border-radius: 6px",
	"cursor: pointer",
	"color: var(--text-normal)",
	"background: var(--background-secondary)",
	"border: 1px solid var(--background-modifier-border)",
	"box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25)",
].join(";");

export default class CopyImagePlugin extends Plugin {
	touchTime = 0;
	// Floating toolbar shown on the image the mouse is hovering over.
	private toolbar: HTMLElement | null = null;
	private actionButton: HTMLElement | null = null;
	private hoverImage: HTMLImageElement | null = null;

	async onload() {
		if (Platform.isMobile) {
			// Mobile has no hover — keep the long-press gesture for copying.
			this.registerDomEvent(
				document,
				"touchstart",
				this.handleTouchStart.bind(this)
			);
			this.registerDomEvent(
				document,
				"touchmove",
				this.handleTouchMove.bind(this)
			);
		} else {
			// Desktop: show a toolbar when hovering an image. This attaches to the
			// rendered <img> directly, so it works in both reading view and Live
			// Preview without depending on the right-click target / caret.
			this.setupToolbar();
			this.registerDomEvent(
				document,
				"mouseover",
				this.handleMouseOver.bind(this)
			);
			this.registerDomEvent(
				document,
				"scroll",
				() => this.hideToolbar(),
				{ capture: true }
			);
		}

		// Command (assign a hotkey in settings) — copies the image on the line
		// at the cursor.
		this.addCommand({
			id: "copy-image",
			name: "Copy image to clipboard",
			editorCallback: this.handleCommand.bind(this),
		});
	}

	onunload() {
		this.toolbar?.remove();
		this.toolbar = null;
		this.actionButton = null;
	}

	// --- Hover toolbar -----------------------------------------------------

	private setupToolbar() {
		const toolbar = document.body.createDiv({ cls: "copy-image-toolbar" });
		toolbar.style.cssText = [
			"position: fixed",
			"z-index: var(--layer-popover, 100)",
			"display: none",
			"gap: 4px",
		].join(";");

		const copyButton = toolbar.createDiv({ cls: "copy-image-button" });
		copyButton.style.cssText = BUTTON_STYLE;
		setIcon(copyButton, "copy");
		copyButton.setAttribute("aria-label", "Copy image to clipboard");

		const actionButton = toolbar.createDiv({ cls: "copy-image-button" });
		actionButton.style.cssText = BUTTON_STYLE;

		// Don't let pressing a button move the editor caret or steal focus.
		toolbar.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		copyButton.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.hoverImage) await this.copyImage(this.hoverImage);
		});
		actionButton.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.hoverImage) this.openOrReveal(this.hoverImage);
		});

		this.toolbar = toolbar;
		this.actionButton = actionButton;
	}

	private handleMouseOver(evt: MouseEvent) {
		// Pixel-precise lookup only — hovering near (but not over) an image must
		// not surface the toolbar on the wrong element.
		const image = this.imageFromPoint(evt.clientX, evt.clientY);
		if (image && this.isVisibleImage(image)) {
			this.showToolbar(image);
		} else {
			this.hideToolbar();
		}
	}

	// Ignore tiny inline icons, hidden images, and off-screen images.
	private isVisibleImage(image: HTMLImageElement): boolean {
		const r = image.getBoundingClientRect();
		return (
			r.width >= 48 &&
			r.height >= 48 &&
			r.bottom > 0 &&
			r.right > 0 &&
			r.top < window.innerHeight &&
			r.left < window.innerWidth
		);
	}

	private showToolbar(image: HTMLImageElement) {
		if (!this.toolbar) return;
		this.hoverImage = image;

		// Configure the second button based on whether the image is remote.
		const remote = this.isRemote(image.src);
		if (this.actionButton) {
			this.actionButton.empty();
			setIcon(this.actionButton, remote ? "external-link" : "folder-open");
			this.actionButton.setAttribute(
				"aria-label",
				remote ? "Open in browser" : "Reveal in file explorer"
			);
		}

		this.toolbar.style.display = "flex";

		const rect = image.getBoundingClientRect();
		const margin = 8;
		const w = this.toolbar.offsetWidth || 64;
		const h = this.toolbar.offsetHeight || 28;
		// Bottom-right corner: editor/embed controls (e.g. the `</>` edit button)
		// live at the top, so this keeps clear of them. Clamp into both the image
		// and the viewport so the toolbar always stays visible and on the image.
		let left = rect.right - w - margin;
		let top = rect.bottom - h - margin;
		left = Math.min(left, window.innerWidth - w - margin);
		left = Math.max(left, rect.left + margin);
		top = Math.min(top, window.innerHeight - h - margin);
		top = Math.max(top, rect.top + margin);

		this.toolbar.style.left = `${left}px`;
		this.toolbar.style.top = `${top}px`;
	}

	private hideToolbar() {
		this.hoverImage = null;
		if (this.toolbar) this.toolbar.style.display = "none";
	}

	private async copyImage(image: HTMLImageElement) {
		try {
			new Notice("Copying the image...");
			await this.trySetFocus();
			await this.waitForFocus();
			await this.copyImageElement(image);
		} catch (e) {
			new Notice(e.message);
		}
	}

	// Reveal a local image in the system file explorer, or open a remote image
	// in the default browser.
	private openOrReveal(image: HTMLImageElement) {
		const src = image.src;
		if (this.isRemote(src)) {
			window.open(src, "_blank");
			return;
		}

		const fullPath = this.localPathFromSrc(src);
		if (!fullPath) {
			new Notice("Could not locate the image file.");
			return;
		}
		try {
			// `electron` is provided by the Obsidian desktop runtime (external).
			const { shell } = require("electron");
			shell.showItemInFolder(fullPath);
		} catch (e) {
			new Notice("Reveal in file explorer is only available on desktop.");
		}
	}

	private isRemote(src: string): boolean {
		return /^https?:/i.test(src);
	}

	// Map a rendered image's src back to an absolute filesystem path.
	private localPathFromSrc(src: string): string | null {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return null;

		const clean = src.split("?")[0];
		const file = this.app.vault
			.getFiles()
			.find(
				(f) => adapter.getResourcePath(f.path).split("?")[0] === clean
			);
		if (file) return adapter.getFullPath(file.path);

		// Fallback: decode the path out of the `app://<host>/<path>` URL.
		try {
			const url = new URL(src);
			if (url.protocol === "app:" || url.protocol === "file:") {
				return decodeURIComponent(url.pathname);
			}
		} catch (e) {
			/* not a parseable URL */
		}
		return null;
	}

	// --- Command path ------------------------------------------------------

	private async handleCommand(editor: Editor, _view: MarkdownView) {
		const ref = this.findImageRef(editor.getLine(editor.getCursor().line));
		if (!ref) {
			new Notice("Not an image file or not supported...");
			return;
		}
		try {
			new Notice("Copying the image...");
			await this.trySetFocus();
			await this.waitForFocus();
			await this.copyImageByRef(ref);
		} catch (e) {
			new Notice(e.message);
		}
	}

	// Parse the first image link out of a markdown source line.
	private findImageRef(line: string): ImageRef | null {
		// Wikilink embed: ![[name.png|alias]]
		const wiki = line.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
		if (wiki) {
			const name = (wiki[1].trim().split("/").pop() ?? "");
			if (this.isSupportedImage(name)) return { kind: "vault", name };
		}

		// Markdown image: ![alt](url "optional title")
		const md = line.match(/!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/);
		if (md) {
			const raw = md[1].trim();
			if (/^(https?:|app:|data:)/i.test(raw)) {
				return { kind: "url", url: raw };
			}
			const name = (decodeURI(raw).split("/").pop() ?? "");
			if (this.isSupportedImage(name)) return { kind: "vault", name };
		}

		return null;
	}

	private isSupportedImage(name: string): boolean {
		const ext = name.split(".").pop()?.toLowerCase();
		return !!ext && SUPPORTED_EXTENSIONS.includes(ext);
	}

	// Resolve the source URL for an ImageRef, load it, and copy it.
	private async copyImageByRef(ref: ImageRef) {
		let url: string;
		if (ref.kind === "url") {
			url = ref.url;
		} else {
			const file = this.app.vault.getFiles().find((f) => f.name === ref.name);
			if (!file) {
				new Notice("Image file not found in vault...");
				return;
			}
			url = this.app.vault.adapter.getResourcePath(file.path);
		}

		const img = new Image();
		img.crossOrigin = "anonymous";
		img.src = url;
		await this.copyImageElement(img);
	}

	// --- Mobile touch path -------------------------------------------------

	private async handleTouchStart(evt: TouchEvent) {
		const image = this.resolveImage(evt.target);
		if (!image) return;
		this.touchTime = new Date().getTime();
		setTimeout(async () => {
			if (this.touchTime !== 0) {
				await this.copyImage(image);
			}
		}, 1000);
	}

	private handleTouchMove() {
		this.touchTime = 0;
	}

	// --- Image lookup ------------------------------------------------------

	// Find a rendered <img> at the given viewport pixel.
	private imageFromPoint(x: number, y: number): HTMLImageElement | null {
		const stack = document.elementsFromPoint(x, y);
		for (const el of stack) {
			if (el instanceof HTMLImageElement) return el;
		}
		return null;
	}

	// Find the underlying <img> for a target element. Handles the element being
	// the image itself, an ancestor embed container, or a child.
	private resolveImage(target: EventTarget | null): HTMLImageElement | null {
		if (target instanceof HTMLImageElement) return target;
		if (!(target instanceof Element)) return null;

		const img = target.closest("img");
		if (img instanceof HTMLImageElement) return img;

		const embed = target.closest(
			".image-embed, .internal-embed, .media-embed, .markdown-embed"
		);
		const embedImg = embed?.querySelector("img");
		return embedImg instanceof HTMLImageElement ? embedImg : null;
	}

	// --- Focus / clipboard -------------------------------------------------

	private async wait(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async trySetFocus() {
		if (!document.hasFocus()) {
			const obsidianWindow = window.open("obsidian://open", "_self");
			if (obsidianWindow) {
				obsidianWindow.focus();
			} else {
				throw new Error("Failed to focus Obsidian app.");
			}
		}
	}

	private async waitForFocus() {
		let timeElapsed = 0;
		while (!document.hasFocus() && timeElapsed < 2000) {
			await this.wait(50);
			timeElapsed += 50;
		}
		if (!document.hasFocus()) {
			throw new Error(
				"Cannot copy image to clipboard without Obsidian app focused."
			);
		}
	}

	// Copy any rendered <img> by re-encoding it to PNG through a canvas. This
	// avoids relying on the blob MIME type (Obsidian's `app://` resources report
	// an empty type) and supports any format the renderer can display.
	private async copyImageElement(img: HTMLImageElement) {
		if (!img.complete || img.naturalWidth === 0) {
			await new Promise<void>((resolve) => {
				img.addEventListener("load", () => resolve(), { once: true });
				img.addEventListener("error", () => resolve(), { once: true });
			});
		}

		const blob = await this.pngBlobFromImage(img);
		if (!blob) {
			new Notice("Failed to copy...");
			return;
		}
		await this.copyPngToClipboard(blob);
	}

	// Draw an image element onto a canvas and export it as a PNG blob. Returns
	// null if the image never loaded or the canvas is tainted (a cross-origin
	// image served without CORS headers).
	private async pngBlobFromImage(img: HTMLImageElement): Promise<Blob | null> {
		const width = img.naturalWidth || img.width;
		const height = img.naturalHeight || img.height;
		if (!width || !height) return null;

		try {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return null;
			ctx.drawImage(img, 0, 0);
			return await new Promise<Blob | null>((resolve) =>
				canvas.toBlob((b) => resolve(b), "image/png")
			);
		} catch (e) {
			// Canvas tainted (cross-origin image without CORS) or drawing failed.
			return null;
		}
	}

	private async copyPngToClipboard(imageBlob: Blob) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": imageBlob }),
			]);
			new Notice("Image copied to clipboard!");
		} catch (error) {
			new Notice("Failed to copy...");
		}
	}
}
