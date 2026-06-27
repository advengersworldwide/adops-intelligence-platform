import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/**
 * Render an invoice DOM node to a single-page A4 PDF and trigger a download.
 *
 * Uses html-to-image (SVG <foreignObject>) rather than html2canvas: it
 * rasterizes via the real browser layout engine, so vertical centering,
 * line-height, and fonts match the on-screen rendering exactly. html2canvas
 * re-implements its own renderer and shifts text toward the top of each box,
 * which broke vertical alignment in the generated PDF.
 *
 * The whole invoice is scaled to fit within one A4 page (preserving aspect
 * ratio, centered, with a small margin) so nothing is ever clipped on any edge.
 */
export async function downloadInvoicePdf(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    cacheBust: true,
    width: node.offsetWidth,
    height: node.scrollHeight,
  });

  // Read back the rasterized dimensions so we can preserve the aspect ratio.
  const img = await loadImage(dataUrl);

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  // Scale to fit inside the printable area without distortion or clipping.
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (pageW - drawW) / 2;
  const y = margin;

  pdf.addImage(dataUrl, "PNG", x, y, drawW, drawH);
  pdf.save(filename);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
