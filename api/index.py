import os
import sys

# Ensure root directory is on Python path so backend can be imported
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend import create_app

app = create_app()

# Vercel looks for the WSGI application callable
if __name__ == "__main__":
    app.run()
