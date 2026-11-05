import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "挖矿",
  description: "Pearl P池挖矿看板",
};

/**
 * /pearl 由本页承接，避免请求落到 Next 时 404。
 * 看板内容在 public/pearl/index.html（同源静态文件），iframe 指向它而不是 /pearl，避免套娃。
 */
export default function PearlPage() {
  return (
    <iframe
      title="Pearl P池挖矿看板"
      src="/pearl/index.html"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        background: "#0d0e12",
      }}
    />
  );
}
