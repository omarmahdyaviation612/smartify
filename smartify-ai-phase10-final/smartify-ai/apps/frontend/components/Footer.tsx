import Image from "next/image";
import { SmartifyContainer } from "@smartify/ui";
import type { Locale, MarketingCopy } from "@/content/marketing";

export function Footer({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  return (
    <footer className="border-t border-neutral-200 bg-navy-900 py-12 text-neutral-300">
      <SmartifyContainer className="flex flex-col items-center gap-4 text-center">
        <Image src="/brand/smartify-logo.png" alt="Smartify AI" width={48} height={48} />
        <p className="text-sm tracking-wide">{copy.footer.tagline}</p>
        <p className="text-xs text-neutral-500">
          © {new Date().getFullYear()} Smartify AI. {copy.footer.rights}
        </p>
      </SmartifyContainer>
    </footer>
  );
}
