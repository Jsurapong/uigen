import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

import { signIn as signInAction, signUp as signUpAction } from "@/actions";
import { getAnonWorkData, clearAnonWork } from "@/lib/anon-work-tracker";
import { getProjects } from "@/actions/get-projects";
import { createProject } from "@/actions/create-project";

const mockSignInAction = vi.mocked(signInAction);
const mockSignUpAction = vi.mocked(signUpAction);
const mockGetAnonWorkData = vi.mocked(getAnonWorkData);
const mockClearAnonWork = vi.mocked(clearAnonWork);
const mockGetProjects = vi.mocked(getProjects);
const mockCreateProject = vi.mocked(createProject);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" } as any);
});

describe("useAuth", () => {
  describe("initial state", () => {
    test("isLoading starts as false", () => {
      const { result } = renderHook(() => useAuth());
      expect(result.current.isLoading).toBe(false);
    });

    test("exposes signIn, signUp and isLoading", () => {
      const { result } = renderHook(() => useAuth());
      expect(typeof result.current.signIn).toBe("function");
      expect(typeof result.current.signUp).toBe("function");
      expect(typeof result.current.isLoading).toBe("boolean");
    });
  });

  describe("signIn", () => {
    test("sets isLoading to true during sign-in and false after", async () => {
      let resolveSignIn!: (v: any) => void;
      mockSignInAction.mockReturnValue(
        new Promise((res) => (resolveSignIn = res))
      );

      const { result } = renderHook(() => useAuth());

      let promise: Promise<any>;
      act(() => {
        promise = result.current.signIn("user@example.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignIn({ success: false, error: "Invalid credentials" });
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("returns the result from signInAction", async () => {
      const authResult = { success: false, error: "Invalid credentials" };
      mockSignInAction.mockResolvedValue(authResult);

      const { result } = renderHook(() => useAuth());
      let returned: any;

      await act(async () => {
        returned = await result.current.signIn("user@example.com", "wrong");
      });

      expect(returned).toEqual(authResult);
    });

    test("calls signInAction with email and password", async () => {
      mockSignInAction.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("test@example.com", "mypassword");
      });

      expect(mockSignInAction).toHaveBeenCalledWith(
        "test@example.com",
        "mypassword"
      );
    });

    test("does not navigate when sign-in fails", async () => {
      mockSignInAction.mockResolvedValue({
        success: false,
        error: "Invalid credentials",
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "wrong");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    test("sets isLoading to false even when signInAction throws", async () => {
      mockSignInAction.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("signUp", () => {
    test("sets isLoading to true during sign-up and false after", async () => {
      let resolveSignUp!: (v: any) => void;
      mockSignUpAction.mockReturnValue(
        new Promise((res) => (resolveSignUp = res))
      );

      const { result } = renderHook(() => useAuth());

      let promise: Promise<any>;
      act(() => {
        promise = result.current.signUp("user@example.com", "password123");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSignUp({ success: false });
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("returns the result from signUpAction", async () => {
      const authResult = { success: false, error: "Email already registered" };
      mockSignUpAction.mockResolvedValue(authResult);

      const { result } = renderHook(() => useAuth());
      let returned: any;

      await act(async () => {
        returned = await result.current.signUp("existing@example.com", "pass");
      });

      expect(returned).toEqual(authResult);
    });

    test("calls signUpAction with email and password", async () => {
      mockSignUpAction.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@example.com", "securepass");
      });

      expect(mockSignUpAction).toHaveBeenCalledWith(
        "new@example.com",
        "securepass"
      );
    });

    test("does not navigate when sign-up fails", async () => {
      mockSignUpAction.mockResolvedValue({
        success: false,
        error: "Email already registered",
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("existing@example.com", "pass");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    test("sets isLoading to false even when signUpAction throws", async () => {
      mockSignUpAction.mockRejectedValue(new Error("Server error"));

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("user@example.com", "pass").catch(() => {});
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("post sign-in navigation — anonymous work present", () => {
    test("creates project from anon work, clears it, and navigates to it", async () => {
      const anonWork = {
        messages: [{ role: "user", content: "hello" }],
        fileSystemData: { "/App.jsx": { type: "file", content: "..." } },
      };
      mockGetAnonWorkData.mockReturnValue(anonWork);
      mockSignInAction.mockResolvedValue({ success: true });
      mockCreateProject.mockResolvedValue({ id: "anon-project-42" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "password");
      });

      expect(mockCreateProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/^Design from /),
        messages: anonWork.messages,
        data: anonWork.fileSystemData,
      });
      expect(mockClearAnonWork).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/anon-project-42");
      expect(mockGetProjects).not.toHaveBeenCalled();
    });

    test("does not use anon work when messages array is empty", async () => {
      mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "existing-1" }] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "password");
      });

      expect(mockCreateProject).not.toHaveBeenCalledWith(
        expect.objectContaining({ messages: [] })
      );
      expect(mockPush).toHaveBeenCalledWith("/existing-1");
    });
  });

  describe("post sign-in navigation — no anonymous work", () => {
    test("redirects to the most recent existing project", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([
        { id: "project-recent" },
        { id: "project-older" },
      ] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "password");
      });

      expect(mockPush).toHaveBeenCalledWith("/project-recent");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("creates a new project when no existing projects found", async () => {
      mockSignInAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ id: "brand-new" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "password");
      });

      expect(mockCreateProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/^New Design #/),
        messages: [],
        data: {},
      });
      expect(mockPush).toHaveBeenCalledWith("/brand-new");
    });

    test("same post-sign-in flow applies after successful signUp", async () => {
      mockSignUpAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([{ id: "first-project" }] as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@example.com", "password");
      });

      expect(mockPush).toHaveBeenCalledWith("/first-project");
    });

    test("creates a new project after successful signUp when no projects exist", async () => {
      mockSignUpAction.mockResolvedValue({ success: true });
      mockGetProjects.mockResolvedValue([]);
      mockCreateProject.mockResolvedValue({ id: "signup-project" } as any);

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("brand-new@example.com", "password");
      });

      expect(mockCreateProject).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/signup-project");
    });
  });
});
