import type { ReactNode } from "react";

/** Shared page-width container — keeps horizontal rhythm consistent across marketing + app pages. */
export function SmartifyContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
