// The small part of fontkit (PDFKit's font engine) used directly here.
declare module 'fontkit' {
  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function openSync(path: string): Font;
}
