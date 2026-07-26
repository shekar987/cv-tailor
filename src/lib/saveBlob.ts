"use client";

// Trigger a browser download for an in-memory blob.
//
// Two details decide whether this works on someone else's browser:
//  - the anchor must be IN the document when clicked. Firefox ignores click()
//    on a detached element, so a download built this way silently does nothing.
//  - revoking the object URL in the same task can cancel the download before
//    the browser has read the blob, so the revoke is deferred.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
