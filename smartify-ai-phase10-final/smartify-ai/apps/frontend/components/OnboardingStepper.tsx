import { SmartifyContainer } from "@smartify/ui";

export function OnboardingStepper({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <div className="border-b border-neutral-200 bg-white py-6">
      <SmartifyContainer className="flex flex-wrap items-center justify-center gap-4">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                i <= currentIndex ? "bg-ai-gradient text-white" : "bg-neutral-100 text-neutral-400"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${i === currentIndex ? "font-semibold text-navy-900" : "text-neutral-500"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <span className="mx-1 text-neutral-300">—</span>}
          </div>
        ))}
      </SmartifyContainer>
    </div>
  );
}
