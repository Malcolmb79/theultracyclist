import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { UnitsProvider } from "./context/UnitsContext";

export default function App() {
  return (
    <UnitsProvider>
      <RouterProvider router={router} />
    </UnitsProvider>
  );
}
