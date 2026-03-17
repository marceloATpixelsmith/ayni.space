export default function DashboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid gap-4 w-full max-w-lg">
        <div className="p-4 border rounded">Logged in successfully</div>
        <div className="p-4 border rounded">Current user: <span className="font-mono">(placeholder)</span></div>
        <div className="p-4 border rounded">Current org: <span className="font-mono">(placeholder)</span></div>
        <div className="p-4 border rounded">Current role: <span className="font-mono">(placeholder)</span></div>
        <div className="p-4 border rounded">Active session status: <span className="font-mono">(placeholder)</span></div>
        <div className="p-4 border rounded">Verified email status: <span className="font-mono">(placeholder)</span></div>
        <div className="p-4 border rounded">Available permissions: <span className="font-mono">(placeholder)</span></div>
      </div>
    </main>
  );
}