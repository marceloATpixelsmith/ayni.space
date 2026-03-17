export default function SessionExpiredPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4 text-yellow-600">Session Expired</h1>
      <p className="mb-4 text-gray-600">Your session has expired. Please log in again.</p>
      <a href="/login" className="text-blue-600 hover:underline">Return to Login</a>
    </main>
  );
}