import { Car } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white shadow">
            <Car className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            ReservarCarro
          </h1>
          <p className="text-sm text-gray-500">Sistema de controle de frota</p>
        </div>

        {children}
      </div>
    </div>
  );
}
