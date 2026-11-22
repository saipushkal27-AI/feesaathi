import { Link } from 'react-router-dom';

const ITEMS = [
  { label: 'Payments', to: '/more/payments' },
  { label: 'Expenses', to: '/expenses' },
  { label: 'Bills', to: '/bills' },
  { label: 'Cash forecast', to: '/forecast' },
  { label: 'Alerts', to: '/alerts' },
  { label: 'Reports', to: '/reports' },
  { label: 'FeeSaathi AI', to: '/ai' },
  { label: 'Settings', to: '/settings' },
];

export default function More() {
  return (
    <div>
      <h1 className="page-title">More</h1>
      <div className="card">
        <ul className="more-list">
          {ITEMS.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>{item.label}</Link>
              <span>›</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
