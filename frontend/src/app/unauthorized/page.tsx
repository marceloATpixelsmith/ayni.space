export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4 text-red-600">Unauthorized</h1>
      <p className="mb-4 text-gray-600">You do not have permission to access this page.</p>
      <a href="/login" className="text-blue-600 hover:underline">Return to Login</a>
    </main>
  );
}