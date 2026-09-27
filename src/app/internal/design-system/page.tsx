import type { Metadata } from "next";

import { DesignGallery } from "./design-gallery";

export const metadata: Metadata = {
  title: "گالری اجزای رابط کاربری | آرمانی کافه",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return <DesignGallery />;
}
