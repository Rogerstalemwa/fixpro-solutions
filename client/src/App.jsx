import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Home from './pages/Home.jsx';
import Services from './pages/Services.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Book from './pages/Book.jsx';
import Admin from './pages/Admin.jsx';
import Technician from './pages/Technician.jsx';
import TechnicianRegister from './pages/TechnicianRegister.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import AdminTechnician from './pages/AdminTechnician.jsx';
import NotFound from './pages/NotFound.jsx';
import { STAFF_ROLES } from './lib/auth.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="services" element={<Services />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="register/technician" element={<TechnicianRegister />} />
        <Route path="bookings/:id" element={<ProtectedRoute roles={['CUSTOMER', ...STAFF_ROLES]}><BookingDetail /></ProtectedRoute>} />
        <Route path="dashboard" element={<ProtectedRoute roles={['CUSTOMER']}><Dashboard /></ProtectedRoute>} />
        <Route path="book" element={<ProtectedRoute roles={['CUSTOMER']}><Book /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute roles={STAFF_ROLES}><Admin /></ProtectedRoute>} />
        <Route path="admin/technicians/:id" element={<ProtectedRoute roles={['OPERATIONS_ADMIN']}><AdminTechnician /></ProtectedRoute>} />
        <Route path="technician" element={<ProtectedRoute roles={['COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN']}><Technician /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
