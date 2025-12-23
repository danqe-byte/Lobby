import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, Button, FlatList, SafeAreaView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { io, Socket } from 'socket.io-client';

type Message = {
  id: number;
  sender: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
};

type Screen = 'home' | 'lobby';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [nickname, setNickname] = useState('');
  const [lobbyCode, setLobbyCode] = useState('');
  const [serverUrl, setServerUrl] = useState('http://localhost:3001');
  const [apiKey, setApiKey] = useState('');
  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const socketRef = useRef<Socket | null>(null);

  const connectSocket = (code: string, name: string) => {
    const socket = io(serverUrl, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinLobby', { code, nickname: name }, (response?: { error?: string }) => {
        if (response?.error) {
          Alert.alert('Join failed', response.error);
          return;
        }
      });
    });

    socket.on('message', (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('users', (list: string[]) => {
      setUsers(list);
    });

    socket.on('disconnect', () => {
      setUsers([]);
    });
  };

  const fetchMessages = async (code: string) => {
    try {
      const res = await fetch(`${serverUrl}/lobby/${code}/messages`);
      if (!res.ok) {
        throw new Error('Unable to load messages');
      }
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not load messages');
    }
  };

  const handleCreate = async () => {
    if (!nickname.trim()) {
      Alert.alert('Validation', 'Nickname is required');
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, openaiApiKey: apiKey || undefined })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create lobby');
      }
      setLobbyCode(data.code);
      setApiKey('');
      setScreen('lobby');
      await fetchMessages(data.code);
      connectSocket(data.code, nickname);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not create lobby');
    }
  };

  const handleJoin = async () => {
    if (!nickname.trim() || !lobbyCode.trim()) {
      Alert.alert('Validation', 'Nickname and lobby code are required');
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/lobby/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, code: lobbyCode })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to join lobby');
      }
      setScreen('lobby');
      await fetchMessages(lobbyCode);
      connectSocket(lobbyCode, nickname);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not join lobby');
    }
  };

  const handleSend = () => {
    if (!inputMessage.trim() || !socketRef.current) return;
    const content = inputMessage;
    setInputMessage('');
    socketRef.current.emit('message', { code: lobbyCode, nickname, content }, (response?: { error?: string }) => {
      if (response?.error) {
        Alert.alert('Message failed', response.error);
      }
    });
  };

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={styles.messageRow}>
      <Text style={styles.messageMeta}>{item.sender} ({item.role})</Text>
      <Text style={styles.messageText}>{item.content}</Text>
    </View>
  );

  const HomeScreen = (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Lobby DM</Text>
      <TextInput
        placeholder="Nickname"
        value={nickname}
        onChangeText={setNickname}
        style={styles.input}
      />
      <TextInput
        placeholder="Lobby Code"
        value={lobbyCode}
        onChangeText={setLobbyCode}
        autoCapitalize="characters"
        style={styles.input}
      />
      <TextInput
        placeholder="Server URL"
        value={serverUrl}
        onChangeText={setServerUrl}
        style={styles.input}
      />
      <TextInput
        placeholder="(Optional) OpenAI API key for new lobby"
        value={apiKey}
        onChangeText={setApiKey}
        style={styles.input}
        secureTextEntry
      />
      <View style={styles.buttonRow}>
        <Button title="Create" onPress={handleCreate} />
        <Button title="Join" onPress={handleJoin} />
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );

  const LobbyScreen = (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Lobby {lobbyCode}</Text>
      <Text style={styles.subtitle}>Users: {users.join(', ') || 'Waiting for friends...'}</Text>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMessage}
        style={styles.messageList}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inputRow}>
        <TextInput
          placeholder="Say something"
          value={inputMessage}
          onChangeText={setInputMessage}
          style={[styles.input, styles.messageInput]}
        />
        <Button title="Send" onPress={handleSend} />
      </KeyboardAvoidingView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );

  return screen === 'home' ? HomeScreen : LobbyScreen;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5'
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12
  },
  subtitle: {
    marginBottom: 8,
    color: '#666'
  },
  input: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderColor: '#ddd',
    borderWidth: 1
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  messageList: {
    flex: 1,
    marginVertical: 12
  },
  messageRow: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderColor: '#eee',
    borderWidth: 1
  },
  messageMeta: {
    fontSize: 12,
    color: '#666'
  },
  messageText: {
    fontSize: 16,
    marginTop: 4
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  messageInput: {
    flex: 1
  }
});
