import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { UnitsProvider } from "./context/UnitsContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Analytics } from "@vercel/analytics/react";

export default function App() {
  return (
    <UnitsProvider>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Analytics />
      </ThemeProvider>
    </UnitsProvider>
  );
}
