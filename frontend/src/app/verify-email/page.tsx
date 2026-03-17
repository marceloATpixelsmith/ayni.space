export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4">Verify Your Email</h1>
      <p className="mb-4 text-gray-600">Check your inbox for a verification link. If you did not receive an email, you can request another below.</p>
      <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Resend Verification Email</button>
    </main>
  );
}