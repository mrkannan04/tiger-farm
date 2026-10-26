# 🐯 Tiger Farm — Digital Farm Inventory & Record Book

Tiger Farm is an agricultural inventory, procurement, input usage tracking, and analytics web application built with Python, Flask, SQLAlchemy, and Neon Cloud PostgreSQL.

## 🚀 Key Features

* **Permanent Cloud Data Persistence**: Powered by Neon Cloud PostgreSQL with atomic ACID transactions and zero data loss across restarts or sign-outs.
* **Transaction-First Stock Ledger**: Complete immutable audit trail (`INITIAL`, `PURCHASE`, `USAGE`, `ADJUSTMENT`) with running stock balance calculation.
* **Negative Stock Prevention**: Prevents dispensing more input quantities than available in active database stock.
* **Vendor & Purchase Management**: Track vendor bills, unit rates, purchase dates, and receipt attachments.
* **Field Usage Logging**: Record fertilizer and pesticide application by plot location with purpose remarks.
* **Real-Time Analytics & Reporting**: Monthly cost trends, low-stock warnings, CSV import/export, and binary PDF report generation.
* **Vercel & Cloud Ready**: Pre-configured for seamless serverless deployment on Vercel with `@vercel/python`.

## 🛠️ Tech Stack

* **Backend**: Python 3, Flask, SQLAlchemy, Flask-Login, ReportLab
* **Database**: Neon Cloud PostgreSQL / SQLite
* **Frontend**: Vanilla JavaScript (ES6+), Modern Responsive CSS, DM Sans Typography
* **Deployment**: Vercel Serverless WSGI (`api/index.py`, `vercel.json`)

## 📦 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/mrkannan04/tiger-farm.git
cd tiger-farm
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
npm install
```

### 3. Configure environment
Create a `.env` file based on `.env.example`:
```ini
DATABASE_URL=postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require
SECRET_KEY=your-secret-key
```

### 4. Run the development server
```bash
python run.py
```
Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser. Default login: `admin` / `tiger123`.
