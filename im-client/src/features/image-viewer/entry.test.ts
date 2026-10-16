import { expect, it } from "vitest";

import { isImageViewerWindow } from "./entry";

it("selects the independent entrypoint only for the explicit viewer query", () => {
  // 测试目标：验证普通窗口不会误识别为查看器。
  // 构造方法：传入不同 URL 查询串。
  // 输入数据：空串、window=main、window=image-viewer。
  // 预期行为：只有显式 image-viewer 查询参数命中。
  expect(isImageViewerWindow("")).toBe(false);
  expect(isImageViewerWindow("?window=main")).toBe(false);
  expect(isImageViewerWindow("?window=image-viewer")).toBe(true);
});
