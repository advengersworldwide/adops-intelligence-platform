import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

/**
 * Render an invoice DOM node to a multi-page A4 PDF and trigger a download.
 *
 * Uses html-to-image (SVG <foreignObject>) rather than html2canvas: it
 * rasterizes via the real browser layout engine, so vertical centering,
 * line-height, and fonts match the on-screen rendering exactly. html2canvas
 * re-implements its own renderer and shifts text toward the top of each box,
 * which broke vertical alignment in the generated PDF.
 */
export async function downloadInvoicePdf(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    cacheBust: true,
    width: node.offsetWidth,
    height: node.scrollHeight,
  });

  // Read back the rasterized dimensions so the PDF keeps the correct aspect ratio.
  const img = await loadImage(dataUrl);

  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (img.height * imgW) / img.width;

  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
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
