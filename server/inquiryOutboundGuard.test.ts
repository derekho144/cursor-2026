import { describe, expect, it } from "vitest";
import {
  isLikelySupplierOrOutboundReply,
  isStudioSelfName,
  resolveInquiryClientName,
} from "./inquiryOutboundGuard";

const LEWINA_REPLY = `Hi Derek,

Thank you for reaching out. We quote based on the specific scope of each project — could you share more details so I can provide an estimated price range?

Best regards,
Lewina Liu
Account Director
lewina@nowmatters.hk

On Tue, Oct 7, 2026 at 4:23 PM Studio exposureonehk wrote:
> Dear team, 你好
> 我們有個客戶想搵鮑魚盒同盆菜包裝設計，想請問收費大概係幾多？
> Cheers!
> Derek
> JD STUDIO HK
> https://jdstudiohk.com/
`;

describe("isLikelySupplierOrOutboundReply", () => {
  it("detects Lewina / NWMS supplier reply to our packaging RFQ", () => {
    expect(
      isLikelySupplierOrOutboundReply("Re: 查詢包裝設計", LEWINA_REPLY)
    ).toBe(true);
  });

  it("does not flag a normal customer photography inquiry", () => {
    const customer = `Hi JD Studio,

I would like a quotation for product photography of about 30 SKUs next month.
Please let me know your rates.

Thanks,
Amy Chan
`;
    expect(
      isLikelySupplierOrOutboundReply("Product photography quote", customer)
    ).toBe(false);
  });

  it("flags quoted outbound RFQ even without thank-you line", () => {
    const body = `Please see below.

On Mon we wrote:
我們有個客戶想搵包裝設計，想請問收費
Cheers!
Derek
JD STUDIO HK
https://jdstudiohk.com/
`;
    expect(isLikelySupplierOrOutboundReply("Re: 查詢包裝設計", body)).toBe(
      true
    );
  });
});

describe("resolveInquiryClientName", () => {
  it("never greets with Derek when AI mis-extracts our name", () => {
    expect(resolveInquiryClientName("Derek", "Lewina Liu")).toBe("Lewina Liu");
    expect(isStudioSelfName("Derek")).toBe(true);
    expect(isStudioSelfName("JD STUDIO HK")).toBe(true);
  });

  it("keeps a real client name", () => {
    expect(resolveInquiryClientName("Amy Chan", "Amy")).toBe("Amy Chan");
  });

  it("falls back to Sir/Madam when only self names exist", () => {
    expect(resolveInquiryClientName("Derek", "JD Studio")).toBe("Sir/Madam");
  });
});
