import sharp from "sharp";

/** 读成 RGBA raw，供逐像素统计用（alpha 边界、质心、覆盖率）。 */
export async function readRgba(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 不透明内容的包围盒。阈值 8 用于忽略抗锯齿边缘。 */
export function alphaBBox(rgba, threshold = 8) {
  const { data, width, height } = rgba;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 脚底锚点的 x：取底部 bandRatio 高度带内 alpha 的加权质心。
 * 不能用 bbox 中心——角色双脚常不对称，用中心会让走路左右抖。
 */
export function footAnchorX(rgba, bbox, bandRatio = 0.12) {
  const bandTop = Math.floor(bbox.top + bbox.height * (1 - bandRatio));
  const bandBottom = bbox.top + bbox.height;
  let weight = 0;
  let weighted = 0;

  for (let y = bandTop; y < bandBottom; y++) {
    const row = y * rgba.width * 4;
    for (let x = bbox.left; x < bbox.left + bbox.width; x++) {
      const a = rgba.data[row + x * 4 + 3];
      if (a > 8) {
        weight += a;
        weighted += x * a;
      }
    }
  }

  return weight > 0 ? weighted / weight : bbox.left + bbox.width / 2;
}

/** alpha 覆盖率（不透明像素占画面比例），QA 用。 */
export function alphaCoverage(rgba, threshold = 8) {
  const { data, width, height } = rgba;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > threshold) count++;
  return count / (width * height);
}

/**
 * 把内容贴到画布上，脚底对齐 anchorY、水平居中于 anchorX。
 * scaleY 用于呼吸/压扁；dy 为额外垂直偏移（负值向上）。
 */
export async function placeAtAnchor(
  contentBuf,
  { canvasW, canvasH, anchorX, anchorY, targetHeight, scaleY = 1, dy = 0 }
) {
  const meta = await sharp(contentBuf).metadata();
  const h = Math.max(1, Math.round((targetHeight ?? meta.height) * scaleY));

  const resized = await sharp(contentBuf)
    .resize({ height: h, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const rm = await sharp(resized).metadata();

  let left = Math.round(anchorX - rm.width / 2);
  let top = Math.round(anchorY - rm.height + dy);
  let input = resized;
  let w = rm.width;
  let hh = rm.height;

  // 越界就先裁剪输入，再钳制落点——sharp 的 composite 不接受负偏移
  if (left < 0 || top < 0 || left + w > canvasW || top + hh > canvasH) {
    const x0 = Math.max(0, -left);
    const y0 = Math.max(0, -top);
    const x1 = Math.min(w, canvasW - left);
    const y1 = Math.min(hh, canvasH - top);
    if (x1 <= x0 || y1 <= y0) throw new Error("content fully outside canvas");
    input = await sharp(resized)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .png()
      .toBuffer();
    w = x1 - x0;
    hh = y1 - y0;
    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input, left, top }])
    .png()
    .toBuffer();
}

/**
 * 程序化合成一帧：缩放 + 旋转 + 位移，脚底锚点始终对齐 (anchorX, anchorY + dy)。
 * 旋转后以「包围盒底边中点」为落脚点——角色左右对称，小角度下与真实脚底差不到 1px。
 */
export async function composeFrame(
  contentBuf,
  { canvasW, canvasH, anchorX, anchorY, targetHeight, scaleY = 1, scaleX = 1, rotate = 0, dx = 0, dy = 0 }
) {
  const meta = await sharp(contentBuf).metadata();
  const h = Math.max(1, Math.round(targetHeight * scaleY));
  const w = Math.max(1, Math.round(meta.width * (h / meta.height) * scaleX));

  let buf = await sharp(contentBuf)
    .resize({ width: w, height: h, fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  if (Math.abs(rotate) > 0.01) {
    buf = await sharp(buf)
      .rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }

  // 旋转会给图像加一圈透明边，按图像边界对齐会让脚底每帧漂几像素。
  // 所以先量真实内容包围盒，裁掉透明边，再按内容底边对齐。
  const rotated = await readRgba(buf);
  const cb = alphaBBox(rotated);
  if (!cb) throw new Error("frame became fully transparent after rotate");

  buf = await sharp(buf).extract(cb).png().toBuffer();

  const contentW = cb.width;
  const contentH = cb.height;

  let left = Math.round(anchorX + dx - contentW / 2);
  let top = Math.round(anchorY + dy - contentH);
  let input = buf;
  let iw = contentW;
  let ih = contentH;

  if (left < 0 || top < 0 || left + iw > canvasW || top + ih > canvasH) {
    const x0 = Math.max(0, -left);
    const y0 = Math.max(0, -top);
    const x1 = Math.min(iw, canvasW - left);
    const y1 = Math.min(ih, canvasH - top);
    if (x1 <= x0 || y1 <= y0) throw new Error("frame fully outside canvas");
    input = await sharp(buf)
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .png()
      .toBuffer();
    iw = x1 - x0;
    ih = y1 - y0;
    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input, left, top }])
    .png()
    .toBuffer();
}

/** 水平条 spritesheet。 */
export async function stripHorizontal(frames, { frameW, frameH, format = "webp", quality = 92 }) {  const img = sharp({
    create: {
      width: frameW * frames.length,
      height: frameH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(frames.map((buf, i) => ({ input: buf, left: i * frameW, top: 0 })));

  return format === "png"
    ? img.png({ compressionLevel: 9 }).toBuffer()
    : img.webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
}
