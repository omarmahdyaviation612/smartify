import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[--sf-bg-subtle] py-20">
      {/* Clerk's hosted widget has no built-in Arabic localization and sets
          no direction of its own — it inherits the page's dir="rtl" via
          plain CSS inheritance, which visually reorders its English-only
          text (e.g. "Forgot password?" rendering as "?Forgot password").
          Isolating it in its own dir="ltr" scope fixes the bidi bug without
          touching any Clerk-internal markup. */}
      <div dir="ltr">
        <SignIn />
      </div>
    </div>
  );
}
