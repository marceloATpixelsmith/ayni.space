export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="font-bold text-lg">App Shell</div>
        <nav className="flex gap-4 items-center">
          <a href="/app" className="hover:underline">Dashboard</a>
          <a href="/account" className="hover:underline">Account</a>
          <button className="bg-gray-700 px-3 py-1 rounded hover:bg-gray-600">Sign Out</button>
        </nav>
      </header>
      <div className="flex flex-1">
        <aside className="w-48 bg-gray-100 p-4 hidden md:block">
          <div className="mb-4 font-semibold">Sidebar</div>
          <ul className="space-y-2">
            <li><a href="/app" className="text-blue-600 hover:underline">Home</a></li>
            <li><a href="#" className="text-gray-500 cursor-not-allowed">Org Switcher (TODO)</a></li>
          </ul>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
