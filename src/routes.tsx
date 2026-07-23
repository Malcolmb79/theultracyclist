import { createBrowserRouter } from "react-router-dom";
import Layout from "./components/layout/Layout";
import HomePage from "./pages/HomePage";
import RecordPage from "./pages/RecordPage";
import PreviousRecordPage from "./pages/PreviousRecordPage";
import CausePage from "./pages/CausePage";
import JourneyPage from "./pages/JourneyPage";
import JourneyEntryPage from "./pages/JourneyEntryPage";
import FollowPage from "./pages/FollowPage";
import AboutPage from "./pages/AboutPage";
import NotFoundPage from "./pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/the-record", element: <RecordPage /> },
      { path: "/previous-record", element: <PreviousRecordPage /> },
      { path: "/the-cause", element: <CausePage /> },
      { path: "/journey", element: <JourneyPage /> },
      { path: "/journey/:slug", element: <JourneyEntryPage /> },
      { path: "/follow", element: <FollowPage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
