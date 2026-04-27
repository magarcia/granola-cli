import type { Meeting, People, Person, ProseMirrorDoc, Utterance } from '../../src/types.js';

export const mockMeeting: Meeting = {
  id: 'a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6',
  title: 'Q4 Planning Session',
  created_at: '2025-12-18T14:00:00Z',
  updated_at: '2025-12-18T15:30:00Z',
  workspace_id: 'abc12345',
};

export const mockProseMirrorContent: ProseMirrorDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Q4 Planning Session' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Key Decisions' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Launch date moved to January 15th' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Budget approved for contractor support' }],
            },
          ],
        },
      ],
    },
  ],
};

export const mockMeetingWithNotes: Meeting = {
  ...mockMeeting,
  notes: mockProseMirrorContent,
  last_viewed_panel: {
    content: mockProseMirrorContent,
  },
};

export const mockMeetings: Meeting[] = [
  mockMeeting,
  {
    id: 'e5f6g7h8-i9j0-k1l2-m3n4-o5p6q7r8s9t0',
    title: '1:1 with Sarah',
    created_at: '2025-12-18T10:00:00Z',
    updated_at: '2025-12-18T10:45:00Z',
    workspace_id: 'personal123',
  },
  {
    id: 'i9j0k1l2-m3n4-o5p6-q7r8-s9t0u1v2w3x4',
    title: 'Sprint Retrospective',
    created_at: '2025-12-17T15:00:00Z',
    updated_at: '2025-12-17T16:00:00Z',
    workspace_id: 'def67890',
  },
];

export const mockTranscript: Utterance[] = [
  {
    source: 'microphone',
    text: "Let's start with the timeline. Where are we on the Q4 deliverables?",
    start_timestamp: '2025-12-18T14:00:12Z',
    end_timestamp: '2025-12-18T14:00:18Z',
    confidence: 0.95,
  },
  {
    source: 'system',
    text: "We're about two weeks behind on the design phase. The user research took longer than expected.",
    start_timestamp: '2025-12-18T14:00:18Z',
    end_timestamp: '2025-12-18T14:00:31Z',
    confidence: 0.92,
  },
  {
    source: 'system',
    text: 'I think we can make up some time in development if we parallelize the API work.',
    start_timestamp: '2025-12-18T14:00:31Z',
    end_timestamp: '2025-12-18T14:00:45Z',
    confidence: 0.94,
  },
  {
    source: 'microphone',
    text: 'What is the minimum we need from design before dev can start?',
    start_timestamp: '2025-12-18T14:00:45Z',
    end_timestamp: '2025-12-18T14:00:52Z',
    confidence: 0.97,
  },
];

export const mockPerson: Person = {
  name: 'John Doe',
  email: 'john.doe@example.com',
  details: {
    employment: {
      title: 'Engineering Manager',
      name: 'Acme Corp',
    },
  },
};

export const mockAttendees: Person[] = [
  {
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    details: {
      employment: {
        title: 'Product Designer',
        name: 'Acme Corp',
      },
    },
  },
  {
    name: 'Bob Wilson',
    email: 'bob.wilson@partner.com',
  },
];

export const mockPeople: People = {
  creator: mockPerson,
  attendees: mockAttendees,
};

export const mockMeetingWithPeople: Meeting = {
  ...mockMeeting,
  people: mockPeople,
  creator: mockPerson,
  attendees: mockAttendees,
};
