export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4">Sign Up</h1>
      <form className="flex flex-col gap-4 w-full max-w-sm">
        <input type="email" placeholder="Email" className="border p-2 rounded" required />
        <input type="password" placeholder="Password" className="border p-2 rounded" required />
        <button type="submit" className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Sign Up</button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <a href="/login" className="text-blue-600 hover:underline">Already have an account? Login</a>
      </div>
    </main>
  );
}