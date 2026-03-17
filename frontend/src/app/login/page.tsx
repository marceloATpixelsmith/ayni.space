export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4">Login</h1>
      <form className="flex flex-col gap-4 w-full max-w-sm">
        <input type="email" placeholder="Email" className="border p-2 rounded" required />
        <input type="password" placeholder="Password" className="border p-2 rounded" required />
        <button type="submit" className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Login</button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <a href="/forgot-password" className="text-blue-600 hover:underline">Forgot password?</a>
        <a href="/signup" className="text-blue-600 hover:underline">Sign up</a>
      </div>
      <div className="mt-6">
        <a href="/auth/callback/google" className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">Sign in with Google</a>
      </div>
    </main>
  );
}