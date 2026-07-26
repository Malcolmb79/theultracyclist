import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { UnitsProvider } from "./context/UnitsContext";
import { ThemeProvider } from "./context/ThemeContext";

export default function App() {
  return (
    <UnitsProvider>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </UnitsProvider>
  );
}
