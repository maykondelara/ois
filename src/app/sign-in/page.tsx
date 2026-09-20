import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations Intelligence System</p>
          <h1>Sign in</h1>
          <p className="page-intro">
            Sign in with your company account to access operations.
          </p>
        </div>
      </header>

      <section className="inset-form" aria-label="Sign in">
        <SignInForm />
      </section>
    </main>
  );
}
