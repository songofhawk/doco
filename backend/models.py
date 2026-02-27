from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    folders = relationship("Folder", back_populates="knowledge_base", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="knowledge_base", cascade="all, delete-orphan")

class Folder(Base):
    __tablename__ = "folders"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    kb_id = Column(Integer, ForeignKey("knowledge_bases.id"))
    parent_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    knowledge_base = relationship("KnowledgeBase", back_populates="folders")
    parent = relationship("Folder", remote_side=[id], backref="children")
    documents = relationship("Document", back_populates="folder", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, index=True)  # room name / uuid
    title = Column(String, nullable=False)
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    kb_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    folder = relationship("Folder", back_populates="documents")
    knowledge_base = relationship("KnowledgeBase", back_populates="documents")

class YDocUpdate(Base):
    __tablename__ = "ydoc_updates"
    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(String, index=True, nullable=False)
    update = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
