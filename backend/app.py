import os
import random
import re
import string
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, desc
from sqlalchemy.exc import SQLAlchemyError

def database_url():
    url = os.getenv("DATABASE_URL", "sqlite:///brainbuddy.db")
    # Render provides postgres:// on some configurations; SQLAlchemy expects postgresql://.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url

def allowed_origins():
    raw = os.getenv("FRONTEND_ORIGINS", "*").strip()
    if raw == "*" or not raw:
        return "*"
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "change-this-in-render-environment")
app.config["SQLALCHEMY_DATABASE_URI"] = database_url()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins=allowed_origins(), async_mode="threading",
                    logger=False, engineio_logger=False, ping_interval=25, ping_timeout=60)

# Runtime presence is mapped to room code -> sid -> member ID. Keep one Render instance
# unless a shared Socket.IO message queue is configured.
presence = {}

class Room(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(8), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    members = db.relationship("Member", backref="room", lazy=True, cascade="all, delete-orphan")
    messages = db.relationship("ChatMessage", backref="room", lazy=True, cascade="all, delete-orphan")

class Member(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("room.id", ondelete="CASCADE"), nullable=False)
    client_id = db.Column(db.String(80), nullable=False)
    name = db.Column(db.String(24), nullable=False)
    last_seen = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (UniqueConstraint("room_id", "client_id", name="uq_room_client"),)

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("room.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id = db.Column(db.String(80), nullable=False)
    name = db.Column(db.String(24), nullable=False)
    body = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)

with app.app_context():
    db.create_all()

def clean_name(value):
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    return name[:24] or "Buddy"

def clean_client_id(value):
    value = re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:80]
    return value or None

def room_by_code(code):
    code = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())[:8]
    if not code:
        return None
    return Room.query.filter_by(code=code).first()

def member_payload(member, online=True):
    return {"id": member.id, "client_id": member.client_id, "name": member.name, "online": online}

def online_client_ids(code):
    return {client_id for client_id in presence.get(code, {}).values()}

def broadcast_members(code):
    room = room_by_code(code)
    if not room:
        return
    online_ids = online_client_ids(code)
    # The members list intentionally includes only currently connected clients.
    rows = Member.query.filter_by(room_id=room.id).order_by(Member.id.asc()).all()
    active = [member_payload(m, True) for m in rows if m.client_id in online_ids]
    socketio.emit("room:members", {"code": code, "members": active}, to=code)

def message_payload(message):
    created = message.created_at
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {"id": message.id, "client_id": message.client_id, "name": message.name,
            "body": message.body, "created_at": created.isoformat() if created else None}

def recent_messages(room_id, limit=100):
    rows = ChatMessage.query.filter_by(room_id=room_id).order_by(desc(ChatMessage.id)).limit(limit).all()
    return [message_payload(m) for m in reversed(rows)]

def room_response(room, member, code=None):
    online_ids = online_client_ids(room.code)
    # Include this joining member even if broadcast is about to be emitted.
    online_ids.add(member.client_id)
    rows = Member.query.filter_by(room_id=room.id).order_by(Member.id.asc()).all()
    members = [member_payload(m, True) for m in rows if m.client_id in online_ids]
    return {"ok": True, "room": {"code": room.code, "member_id": member.id},
            "members": members, "messages": recent_messages(room.id)}

def attach_member(code, name, client_id):
    room = room_by_code(code)
    if not room:
        return None, None, {"ok": False, "message": "That room code doesn't exist. Check it and try again."}
    member = Member.query.filter_by(room_id=room.id, client_id=client_id).first()
    if member:
        member.name = name
        member.last_seen = datetime.now(timezone.utc)
    else:
        # Keep casual rooms from becoming unbounded; this is a soft product limit.
        count = Member.query.filter_by(room_id=room.id).count()
        if count >= 30:
            return None, None, {"ok": False, "message": "This room is full (30 members maximum)."}
        member = Member(room_id=room.id, client_id=client_id, name=name, last_seen=datetime.now(timezone.utc))
        db.session.add(member)
    db.session.commit()
    return room, member, None

@app.get("/")
def index():
    return jsonify({"service": "BrainBuddy API", "status": "ok", "hint": "Use /health to check backend readiness."})

@app.get("/health")
def health():
    try:
        db.session.execute(db.text("SELECT 1"))
        return jsonify({"status": "ok", "database": "connected"}), 200
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify({"status": "error", "database": "unavailable"}), 503

@socketio.on("room:create")
def create_room(data):
    data = data or {}
    name = clean_name(data.get("name"))
    client_id = clean_client_id(data.get("client_id"))
    if not client_id:
        return {"ok": False, "message": "Refresh the page and try again."}
    room = None
    for _ in range(10):
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not Room.query.filter_by(code=code).first():
            room = Room(code=code)
            db.session.add(room)
            try:
                db.session.commit()
                break
            except SQLAlchemyError:
                db.session.rollback()
                room = None
    if not room:
        return {"ok": False, "message": "Couldn't create a room. Please try again."}
    member = Member(room_id=room.id, client_id=client_id, name=name, last_seen=datetime.now(timezone.utc))
    db.session.add(member)
    db.session.commit()
    join_room(room.code)
    presence.setdefault(room.code, {})[request.sid] = client_id
    response = room_response(room, member)
    broadcast_members(room.code)
    return response

@socketio.on("room:join")
def join_existing_room(data):
    data = data or {}
    code = re.sub(r"[^A-Z0-9]", "", str(data.get("code") or "").upper())[:8]
    name = clean_name(data.get("name"))
    client_id = clean_client_id(data.get("client_id"))
    if not code:
        return {"ok": False, "message": "Enter a valid room code."}
    if not client_id:
        return {"ok": False, "message": "Refresh the page and try again."}
    room, member, error = attach_member(code, name, client_id)
    if error:
        return error
    join_room(room.code)
    presence.setdefault(room.code, {})[request.sid] = client_id
    response = room_response(room, member)
    broadcast_members(room.code)
    return response

@socketio.on("chat:send")
def send_chat(data):
    data = data or {}
    code = re.sub(r"[^A-Z0-9]", "", str(data.get("code") or "").upper())[:8]
    body = re.sub(r"\s+", " ", str(data.get("body") or "")).strip()[:500]
    client_id = clean_client_id(data.get("client_id"))
    if not code or not body or not client_id:
        return {"ok": False, "message": "Write a message first."}
    room = room_by_code(code)
    if not room or request.sid not in presence.get(code, {}):
        return {"ok": False, "message": "Join this room before sending messages."}
    if presence[code][request.sid] != client_id:
        return {"ok": False, "message": "Your session changed. Rejoin the room."}
    member = Member.query.filter_by(room_id=room.id, client_id=client_id).first()
    if not member:
        return {"ok": False, "message": "Your membership expired. Rejoin the room."}
    message = ChatMessage(room_id=room.id, client_id=client_id, name=member.name, body=body)
    db.session.add(message)
    db.session.commit()
    payload = message_payload(message)
    socketio.emit("chat:new", {"code": code, "message": payload}, to=code)
    return {"ok": True, "message": payload}

@socketio.on("disconnect")
def on_disconnect(reason=None):
    sid = request.sid
    affected = []
    for code, sockets in list(presence.items()):
        if sid in sockets:
            del sockets[sid]
            affected.append(code)
            if not sockets:
                del presence[code]
    for code in affected:
        broadcast_members(code)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
