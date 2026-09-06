import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/dashboard");
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-bold">0x</div>
          <div>
            <h1 className="text-lg font-semibold">0xStudy Checker</h1>
            <p className="text-sm text-gray-400">请输入仪表盘密码</p>
          </div>
        </div>
        <LoginForm />
        <p className="mt-6 text-xs text-gray-400 leading-relaxed">
          会话使用 httpOnly Cookie。CEX API 密钥仅存在于服务器环境变量，不会下发到浏览器。
        </p>
      </div>
    </main>
  );
}
