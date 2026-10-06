import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * Renders `text` as an SVG QR code. One <path> of module squares keeps the DOM
 * tiny even at type 10+.
 *
 * Deliberately NOT themed: a QR code is machine-readable before it is
 * decorative, and phone cameras across a dim classroom want maximum contrast
 * plus a real quiet zone. It gets a white plate in every theme, which the
 * surrounding card treats as a deliberate object rather than an accident.
 */
export function QrCode({ text, title }: { text: string; title: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 2;
    const parts: string[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
      }
    }
    return { path: parts.join(''), size: count + margin * 2 };
  }, [text]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0b0b0c" />
    </svg>
  );
}
