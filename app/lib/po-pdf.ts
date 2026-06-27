/**
 * Print an invoice DOM node to PDF using the browser's native print engine.
 *
 * This is the same Chromium print pipeline Playwright/Puppeteer use under the
 * hood, so the output is a true vector PDF — selectable text, crisp lines,
 * perfect fidelity to the on-screen layout, and never clipped. No rasterization
 * (html2canvas / html-to-image) and no server-side headless browser required.
 *
 * The invoice is cloned into a hidden, same-origin iframe along with the page's
 * stylesheets, given an @page A4 print stylesheet, and printed. The user's
 * "Save as PDF" destination produces the downloaded file.
 */
export async function downloadInvoicePdf(node: HTMLElement, filename: string): Promise<void> {
  const title = filename.replace(/\.pdf$/i, "");

  // Clone the page's stylesheets so Tailwind classes and fonts resolve in the iframe.
  const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join("\n");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "794px", // A4 width @96dpi — gives the clone a correct layout viewport
    height: "1123px", // A4 height @96dpi
    border: "0",
  });
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  const idoc = win.document;

  idoc.open();
  idoc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
${styleTags}
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
  /* Force background colors (blue header bars) and text colors to print, regardless
     of the browser's "Background graphics" print setting. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Make the invoice exactly fill one A4 page so the footer stays pinned to the bottom. */
  #invoice-print-root > * {
    width: 210mm !important;
    min-height: 297mm !important;
    margin: 0 !important;
    box-sizing: border-box !important;
  }
</style>
</head>
<body>
<div id="invoice-print-root">${node.outerHTML}</div>
</body>
</html>`);
  idoc.close();

  await waitForAssets(win);

  // Chrome derives the "Save as PDF" filename from the parent document's title
  // (not the iframe's) when printing an iframe, so set it to the PO code and
  // restore it afterwards.
  const originalTitle = document.title;
  document.title = title;

  win.focus();
  win.print();

  const cleanup = () => {
    document.title = originalTitle;
    iframe.remove();
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  // Fallback cleanup in case afterprint never fires (some browsers/headless).
  setTimeout(cleanup, 60000);
}

/** Resolve once the iframe document has loaded its fonts and images. */
function waitForAssets(win: Window): Promise<void> {
  const doc = win.document;

  const ready = async () => {
    try {
      if (doc.fonts?.ready) await doc.fonts.ready;
    } catch {
      /* fonts API unavailable — ignore */
    }
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.onload = () => res();
              img.onerror = () => res();
            }),
      ),
    );
    // Small settle delay so layout is finalized before printing.
    await new Promise((res) => setTimeout(res, 100));
  };

  return new Promise((resolve) => {
    if (doc.readyState === "complete") {
      void ready().then(resolve);
    } else {
      win.addEventListener("load", () => void ready().then(resolve), { once: true });
      // Fallback if load never fires.
      setTimeout(() => void ready().then(resolve), 1500);
    }
  });
}
