import "./globals.css";

export const metadata = {
  title: "Melbourne Local Growth Ops - Ops Console",
  description: "Read-only operational visibility for MLGO platforms.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <header className="header">
            <h1>Ops Console</h1>
            <nav>
              <a href="/">Deployments</a>
            </nav>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
