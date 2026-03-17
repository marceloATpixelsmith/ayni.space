export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="font-bold text-lg">Account</div>
        <nav className="flex gap-4 items-center">
          <a href="/app" className="hover:underline">Dashboard</a>
          <a href="/account" className="hover:underline">Account</a>
          <button className="bg-gray-700 px-3 py-1 rounded hover:bg-gray-600">Sign Out</button>
        </nav>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
