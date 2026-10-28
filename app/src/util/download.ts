/** Save a file from the browser. */
export interface DownloadFile {
  name: string;
  mime: string;
  data: string | Uint8Array | Blob;
}

export function downloadFile(f: DownloadFile) {
  const a = document.createElement('a');
  const blob = f.data instanceof Blob ? f.data : new Blob([f.data as BlobPart], { type: f.mime });
  a.href = URL.createObjectURL(blob);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
