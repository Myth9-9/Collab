# Collab
AI-Assisted Collaborative Diagramming Tool (Minimal, Complete Project)


1 ) Run Postgres via Docker (no psql needed):

docker run --name wb-postgres -e POSTGRES_USER=whiteboard -e POSTGRES_PASSWORD=whiteboard_pw -e POSTGRES_DB=whiteboard -p 5432:5432 -d postgres:16


2 ) Start the Python AI service:

cd .\ai_service\
python -m venv .venv

.\.venv\Scripts\Activate.ps1

pip install -r .\requirements.txt

$env:JWT_SECRET="dev_super_secret_change_me"

uvicorn main:app --reload --port 8000


3 ) Start the Node app:

npm install

if you see "Cannot find package 'cookie-parser'":

run npm i cookie-parser

npm start


# Structure:

ai-whiteboard/

├─ package.json

├─ server.js

├─ .env.example

├─ db/

│  ├─ schema.sql

│  └─ seed.sql

├─ public/

│  ├─ index.html

│  ├─ style.css

│  ├─ app.js

│  └─ ai.js

├─ ai_service/

│  ├─ main.py

│  └─ requirements.txt

├─ Dockerfile

├─ ai_service/Dockerfile

└─ docker-compose.yml
