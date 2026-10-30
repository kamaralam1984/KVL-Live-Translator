import { Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { Dashboard } from './screens/Dashboard';
import { MeetingTranslator } from './screens/MeetingTranslator';
import { MyResponse } from './screens/MyResponse';
import { Settings } from './screens/Settings';
import { TranslationHistory } from './screens/TranslationHistory';
import { MeetingHistory } from './screens/MeetingHistory';
import { ApiProviders } from './screens/ApiProviders';
import { About } from './screens/About';
import { AudioDiagnostics } from './screens/AudioDiagnostics';
import { MiniTranslator } from './screens/MiniTranslator';
import { UsageDashboard } from './screens/UsageDashboard';
import { Debug } from './screens/Debug';
import { Security } from './screens/Security';
import { SetupWizard } from './screens/SetupWizard';

export function AppRoutes() {
  return (
    <Routes>
      {/* Outside AppShell on purpose — the floating mini window has no sidebar. */}
      <Route path="mini" element={<MiniTranslator />} />
      {/* Outside AppShell on purpose — a full-page flow, no sidebar/nav during setup. */}
      <Route path="setup" element={<SetupWizard />} />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="translator" element={<MeetingTranslator />} />
        <Route path="my-response" element={<MyResponse />} />
        <Route path="settings" element={<Settings />} />
        <Route path="history" element={<TranslationHistory />} />
        <Route path="meetings" element={<MeetingHistory />} />
        <Route path="providers" element={<ApiProviders />} />
        <Route path="usage" element={<UsageDashboard />} />
        <Route path="security" element={<Security />} />
        <Route path="diagnostics" element={<AudioDiagnostics />} />
        <Route path="debug" element={<Debug />} />
        <Route path="about" element={<About />} />
      </Route>
    </Routes>
  );
}
