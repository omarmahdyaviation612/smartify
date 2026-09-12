import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[--sf-bg-subtle] py-20">
      {/* Same RTL/bidi fix as sign-in — see that file's comment. */}
      <div dir="ltr">
        <SignUp />
      </div>
    </div>
  );
}
