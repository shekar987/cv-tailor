"use client";

// Client-side "PDF that matches Word" pipeline.
//
// Both downloads share ONE source of truth: the .docx the server builds in
// /api/download (or /api/download-cover). Word = that file as-is. PDF = that
// same file rendered to HTML by docx-preview, then snapshotted. Because both
// come from identical bytes, the PDF content matches the Word document — with
// zero data leaving the browser and no conversion API/cost.
//
// The pagination is the subtle part. docx-preview does NOT reflow text into
// pages: it only starts a new <section> at an EXPLICIT page break, and a .docx
// built by the `docx` library has none (Word writes those itself when it saves
// after laying the document out). So in practice our CVs render as a single
// section that is simply taller than one page — a 3-page CV is one 3-page-tall
// box. Any code that assumes "one section = one page" therefore squashes the
// whole CV onto a single sheet.
//
// So we do our own pagination: measure each section, and cut it into A4-height
// slices. Cuts are placed at the bottom edge of a rendered block (paragraph,
// bullet, heading) so a page never breaks through the middle of a line.
//
// html2canvas turns the page into a flat image, which on its own would make
// every hyperlink dead — blue underlined text that does nothing when clicked.
// We separately record where each real <a href> sits before it's rasterized,
// then overlay genuine clickable PDF link annotations at those coordinates on
// top of the image (see collectLinkRects / pdf.link below).

const JPEG_QUALITY = 0.95;
const CAPTURE_SCALE = 2; // crisp text without an unreasonable payload

// A cut is only pulled back to a block boundary if that still fills most of the
// page. Otherwise a single tall block early on would produce a nearly empty page.
const MIN_PAGE_FILL = 0.6;

// Bottom edges of laid-out blocks, in canvas pixels relative to the section top.
// These are the positions where a page break is visually safe. The largest of
// them is also where the document's content actually ends, which is not the same
// as where the section box ends — see measureSection.
function collectBreakOffsets(section: HTMLElement, scale: number): number[] {
  const sectionTop = section.getBoundingClientRect().top;
  const offsets = new Set<number>();
  section.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, tr, table").forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    // Ignore empty trailing paragraphs: Word documents routinely end with a few,
    // and they would otherwise push the measured content bottom down a page.
    if ((el.textContent || "").trim() === "") return;
    offsets.add(Math.round((rect.bottom - sectionTop) * scale));
  });
  return Array.from(offsets).sort((a, b) => a - b);
}

// How far down the capture we need to paginate.
//
// docx-preview sizes each section to the .docx page height, so a one-third-full
// cover letter still yields a full-A4 box. Paginating to the box height meant
// the leftover strip became an extra, blank PDF page. Stop at the last real
// content instead, plus the page's own bottom margin so the layout still
// breathes the way the Word document does.
function measureSection(section: HTMLElement, breaks: number[], scale: number, canvasHeight: number): number {
  if (breaks.length === 0) return canvasHeight;
  const contentBottom = breaks[breaks.length - 1];
  const bottomMargin = (parseFloat(getComputedStyle(section).paddingBottom) || 0) * scale;
  return Math.min(canvasHeight, contentBottom + bottomMargin);
}

// Where to end the page that starts at `top`, given the ideal (full-page) cut.
function chooseCut(breaks: number[], top: number, ideal: number, limit: number): number {
  if (ideal >= limit) return limit;
  const minimum = top + (ideal - top) * MIN_PAGE_FILL;
  let best = -1;
  for (const offset of breaks) {
    if (offset > ideal) break;
    if (offset >= minimum) best = offset;
  }
  // No block boundary lands in the usable band — cut at the page height. Rare,
  // and only reachable when a single block is taller than most of a page.
  return best > top ? best : ideal;
}

type LinkRect = { url: string; left: number; top: number; width: number; height: number };

// Positions and hrefs of every real hyperlink in a section, in the same
// canvas-pixel space as collectBreakOffsets (relative to the section's own
// top-left, scaled by CAPTURE_SCALE so it lines up with the html2canvas
// capture below).
//
// This exists because html2canvas only produces PIXELS. Without this, a
// hyperlink in the .docx (LinkedIn/GitHub in the header, project links, any
// inline URL) would render as blue underlined text in the PDF that does
// nothing when clicked — every link in the document, not just these two.
function collectLinkRects(section: HTMLElement, scale: number): LinkRect[] {
  const sectionBox = section.getBoundingClientRect();
  const rects: LinkRect[] = [];
  section.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href") || "";
    // Defensive second gate: only ever emit a clickable zone for a real
    // http(s) URL. The source .docx already enforces this before creating an
    // ExternalHyperlink (the S1 sanitization in api/download/route.ts) — this
    // does not relax that, it re-checks independently of what the DOM contains.
    if (!/^https?:\/\//i.test(href)) return;
    // getClientRects() rather than getBoundingClientRect(): a link that wraps
    // across two lines gets one clickable zone per visual line, instead of one
    // box spanning the gap between them (which would also cover any text sitting
    // between the two lines).
    Array.from(el.getClientRects()).forEach((rect) => {
      if (rect.width <= 0 || rect.height <= 0) return;
      rects.push({
        url: href,
        left: (rect.left - sectionBox.left) * scale,
        top: (rect.top - sectionBox.top) * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      });
    });
  });
  return rects;
}

export async function docxBlobToPdf(docxBlob: Blob, fileBaseName: string): Promise<void> {
  const [{ renderAsync }, html2canvasMod, { jsPDF }] = await Promise.all([
    import("docx-preview"),
    import("html2canvas"),
    import("jspdf"),
  ]);
  const html2canvas = html2canvasMod.default;

  // Off-screen but still laid out: html2canvas needs a real box to measure, so
  // `display:none` won't do. Positioning it far to the left keeps it invisible.
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.position = "absolute";
  holder.style.top = "0";
  holder.style.left = "-10000px";
  holder.style.background = "#ffffff";
  document.body.appendChild(holder);

  try {
    // styleContainer defaults to the body container, so docx-preview's CSS is
    // scoped inside `holder` and disappears with it — no styles leak onto the app.
    await renderAsync(docxBlob, holder, undefined, {
      className: "docx",
      inWrapper: true,
      ignoreWidth: false, // keep the .docx page width (A4) for faithful layout
      ignoreHeight: false,
      breakPages: true, // honor any explicit page breaks that do exist
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
    });

    const sections = Array.from(holder.querySelectorAll("section.docx")) as HTMLElement[];
    if (sections.length === 0) throw new Error("docx rendered no pages");

    // docx-preview styles pages for on-screen preview: a grey wrapper, a drop
    // shadow, and a 30px gap under each page. html2canvas would bake all three
    // into the PDF, so neutralise them before snapshotting.
    const wrapper = holder.querySelector(".docx-wrapper") as HTMLElement | null;
    if (wrapper) {
      wrapper.style.background = "#ffffff";
      wrapper.style.padding = "0";
    }
    for (const section of sections) {
      section.style.boxShadow = "none";
      section.style.marginBottom = "0";
    }

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const sheetW = pdf.internal.pageSize.getWidth();
    const sheetH = pdf.internal.pageSize.getHeight();
    let pageAdded = false;

    for (const section of sections) {
      const breaks = collectBreakOffsets(section, CAPTURE_SCALE);
      const links = collectLinkRects(section, CAPTURE_SCALE);
      const canvas = await html2canvas(section, {
        scale: CAPTURE_SCALE,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      // The capture spans the full sheet width, which fixes the scale for both
      // axes; a full page is that many pixels tall.
      const pxPerMm = canvas.width / sheetW;
      const pageHeightPx = sheetH * pxPerMm;

      // Paginate to the end of the CONTENT, not the end of the section box.
      const contentHeight = measureSection(section, breaks, CAPTURE_SCALE, canvas.height);

      const slice = document.createElement("canvas");
      const sliceCtx = slice.getContext("2d");
      if (!sliceCtx) throw new Error("Could not get a 2D canvas context");

      // A leftover strip thinner than this is rounding noise, not a page. Without
      // this floor, a section whose height differs from the computed A4 height by
      // a pixel emits a final, blank page.
      const MIN_SLICE_PX = 4 * pxPerMm; // 4mm

      let top = 0;
      while (top < contentHeight - MIN_SLICE_PX) {
        const bottom = chooseCut(breaks, top, top + pageHeightPx, contentHeight);
        const height = Math.max(1, Math.round(bottom - top));

        slice.width = canvas.width;
        slice.height = height;
        // Canvases start transparent, which JPEG flattens to black.
        sliceCtx.fillStyle = "#ffffff";
        sliceCtx.fillRect(0, 0, slice.width, slice.height);
        sliceCtx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);

        if (pageAdded) pdf.addPage();
        // Height from the slice's own pixels, so a short final page keeps its
        // proportions instead of being stretched to fill the sheet.
        pdf.addImage(
          slice.toDataURL("image/jpeg", JPEG_QUALITY),
          "JPEG", 0, 0, sheetW, Math.min(height / pxPerMm, sheetH)
        );
        pageAdded = true;

        // Overlay REAL clickable PDF link annotations for any hyperlink whose
        // position falls within this page's slice. jsPDF's link() attaches to
        // whichever page was most recently added, so this must happen before
        // the next iteration's addPage() call.
        for (const link of links) {
          const linkBottom = link.top + link.height;
          if (linkBottom <= top || link.top >= bottom) continue; // not on this page
          // Clip to the slice: a link at the very edge of a page break should
          // only get a clickable zone over the portion actually printed here.
          const clippedTop = Math.max(link.top, top);
          const clippedBottom = Math.min(linkBottom, bottom);
          pdf.link(
            link.left / pxPerMm,
            (clippedTop - top) / pxPerMm,
            link.width / pxPerMm,
            (clippedBottom - clippedTop) / pxPerMm,
            { url: link.url }
          );
        }

        top = bottom;
      }
    }

    pdf.save(`${fileBaseName}.pdf`);
  } finally {
    holder.remove();
  }
}
